/**
 * H.265/HEVC VPS NAL unit parser.
 */

import { BitReader } from '../binary/reader.js';
import type { HevcVpsResult, HevcProfileTierLevel } from '../types.js';
import { removeEmulationPrevention } from '../nalu/annexb.js';
import { hevcNalUnitTypeName } from './constants.js';
import { readHevcNalUnitHeader, readHevcProfileTierLevel } from './header.js';

export function parseHevcVpsNaluPayload(
  nalu: Uint8Array, baseByteOffset = 0,
  fieldOffsets: Record<string, { offset: number; length: number }> = {},
  vpsIndex: number | string = 0,
): HevcVpsResult {
  if (!nalu || nalu.length < 2) return {} as HevcVpsResult;
  try {
    const s = {} as HevcVpsResult;
    const keyPrefix = typeof vpsIndex === 'string' ? vpsIndex : `sequenceHeader.vps[${vpsIndex}]`;
    const header = nalu.slice(0, 2);
    const { data: rbsp, removedPositions } = removeEmulationPrevention(nalu.slice(2));
    const combined = new Uint8Array(header.length + rbsp.length);
    combined.set(header, 0); combined.set(rbsp, header.length);
    const adjPos = removedPositions.map(p => p + 2);
    const reader = new BitReader(combined, 0, baseByteOffset, fieldOffsets, keyPrefix, adjPos);

    const hdr = readHevcNalUnitHeader(reader);
    s.forbidden_zero_bit = hdr.forbidden_zero_bit;
    s.nal_unit_type = `${hdr.nal_unit_type} (${hevcNalUnitTypeName(hdr.nal_unit_type)})`;
    s.nuh_layer_id = hdr.nuh_layer_id;
    s.nuh_temporal_id_plus1 = hdr.nuh_temporal_id_plus1;

    s.vps_video_parameter_set_id = reader.readBits(4);
    s.vps_base_layer_internal_flag = reader.readBits(1);
    s.vps_base_layer_available_flag = reader.readBits(1);
    s.vps_max_layers_minus1 = reader.readBits(6);
    const maxSubLayers = reader.readBits(3);
    s.vps_max_sub_layers_minus1 = maxSubLayers;
    s.vps_temporal_id_nesting_flag = reader.readBits(1);
    s.vps_reserved_0xffff_16bits = reader.readBits(16);
    s.profile_tier_level = readHevcProfileTierLevel(reader, keyPrefix);

    const orderingFlag = reader.readBits(1);
    s.vps_sub_layer_ordering_info_present_flag = orderingFlag;
    const startLayer = orderingFlag ? 0 : maxSubLayers;
    for (let i = startLayer; i <= maxSubLayers; i++) {
      s[`vps_max_dec_pic_buffering_minus1[${i}]`] = reader.readUE();
      s[`vps_max_num_reorder_pics[${i}]`] = reader.readUE();
      s[`vps_max_latency_increase_plus1[${i}]`] = reader.readUE();
    }

    s.vps_max_layer_id = reader.readBits(6);
    const numLayerSets = reader.readUE();
    s.vps_num_layer_sets_minus1 = numLayerSets;
    if (numLayerSets > 0) {
      const maxLayerId = (s.vps_max_layer_id as number) ?? 0;
      const flags: number[][] = [];
      for (let i = 1; i <= numLayerSets; i++) {
        const layerFlags: number[] = [];
        for (let j = 0; j <= maxLayerId; j++) layerFlags.push(reader.readBits(1));
        flags.push(layerFlags);
      }
      (s as Record<string, unknown>)._layer_id_included_flags = flags;
    }

    const timingFlag = reader.readBits(1);
    s.vps_timing_info_present_flag = timingFlag;
    if (timingFlag) {
      s.vps_num_units_in_tick = reader.readBits(32);
      s.vps_time_scale = reader.readBits(32);
      const pocFlag = reader.readBits(1);
      s.vps_poc_proportional_to_timing_flag = pocFlag;
      if (pocFlag) s.vps_num_ticks_poc_diff_one_minus1 = reader.readUE();
      const numHrd = reader.readUE();
      s.vps_num_hrd_parameters = numHrd;
      if (numHrd > 0) s._hrd_parameters_skipped = `${numHrd} HRD parameter sets (not parsed)`;
    }

    s.vps_extension_flag = reader.readBits(1);
    if (s.vps_extension_flag) s._vps_extension_data = 'VPS extension data present (not parsed)';

    s.rbsp_stop_one_bit = reader.readBits(1);
    let idx = 0;
    while (reader.bitPosition % 8 !== 0) {
      s[`rbsp_alignment_zero_bit[${idx}]`] = reader.readBits(1);
      idx++;
    }
    return s;
  } catch (err) { return { _parseError: String(err) } as unknown as HevcVpsResult; }
}

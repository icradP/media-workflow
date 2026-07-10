/**
 * H.265/HEVC PPS NAL unit parser.
 */

import { BitReader } from '../binary/reader.js';
import type { HevcPpsResult } from '../types.js';
import { removeEmulationPrevention } from '../nalu/annexb.js';
import { hevcNalUnitTypeName } from './constants.js';
import { readHevcNalUnitHeader } from './header.js';

export function parseHevcPpsNaluPayload(
  nalu: Uint8Array, baseByteOffset = 0,
  fieldOffsets: Record<string, { offset: number; length: number }> = {},
  ppsIndex: number | string = 0,
): HevcPpsResult {
  if (!nalu || nalu.length < 2) return {} as HevcPpsResult;
  try {
    const s = {} as HevcPpsResult;
    const keyPrefix = typeof ppsIndex === 'string' ? ppsIndex : `sequenceHeader.pps[${ppsIndex}]`;
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

    s.pps_pic_parameter_set_id = reader.readUE();
    s.pps_seq_parameter_set_id = reader.readUE();
    s.dependent_slice_segments_enabled_flag = reader.readBits(1);
    s.output_flag_present_flag = reader.readBits(1);
    s.num_extra_slice_header_bits = reader.readBits(3);
    s.sign_data_hiding_enabled_flag = reader.readBits(1);
    s.cabac_init_present_flag = reader.readBits(1);
    s.num_ref_idx_l0_default_active_minus1 = reader.readUE();
    s.num_ref_idx_l1_default_active_minus1 = reader.readUE();
    s.init_qp_minus26 = reader.readSE();
    s.constrained_intra_pred_flag = reader.readBits(1);
    s.transform_skip_enabled_flag = reader.readBits(1);

    const cuQpFlag = reader.readBits(1);
    s.cu_qp_delta_enabled_flag = cuQpFlag;
    if (cuQpFlag) s.diff_cu_qp_delta_depth = reader.readUE();

    s.pps_cb_qp_offset = reader.readSE();
    s.pps_cr_qp_offset = reader.readSE();
    s.pps_slice_chroma_qp_offsets_present_flag = reader.readBits(1);
    s.weighted_pred_flag = reader.readBits(1);
    s.weighted_bipred_flag = reader.readBits(1);
    s.transquant_bypass_enabled_flag = reader.readBits(1);

    const tilesFlag = reader.readBits(1);
    s.tiles_enabled_flag = tilesFlag;
    s.entropy_coding_sync_enabled_flag = reader.readBits(1);
    if (tilesFlag) {
      s.num_tile_columns_minus1 = reader.readUE();
      s.num_tile_rows_minus1 = reader.readUE();
      s.uniform_spacing_flag = reader.readBits(1);
      s.loop_filter_across_tiles_enabled_flag = reader.readBits(1);
    }

    s.pps_loop_filter_across_slices_enabled_flag = reader.readBits(1);
    const dfFlag = reader.readBits(1);
    s.deblocking_filter_control_present_flag = dfFlag;
    if (dfFlag) {
      s.deblocking_filter_override_enabled_flag = reader.readBits(1);
      const dfDisabled = reader.readBits(1);
      s.pps_deblocking_filter_disabled_flag = dfDisabled;
      if (!dfDisabled) {
        s.pps_beta_offset_div2 = reader.readSE();
        s.pps_tc_offset_div2 = reader.readSE();
      }
    }

    s.pps_scaling_list_data_present_flag = reader.readBits(1);
    s.lists_modification_present_flag = reader.readBits(1);
    s.log2_parallel_merge_level_minus2 = reader.readUE();
    s.slice_segment_header_extension_present_flag = reader.readBits(1);
    s.pps_extension_present_flag = reader.readBits(1);

    s.rbsp_stop_one_bit = reader.readBits(1);
    let idx = 0;
    while (reader.bitPosition % 8 !== 0) {
      s[`rbsp_alignment_zero_bit[${idx}]`] = reader.readBits(1);
      idx++;
    }
    return s;
  } catch (err) { return { _parseError: String(err) } as unknown as HevcPpsResult; }
}

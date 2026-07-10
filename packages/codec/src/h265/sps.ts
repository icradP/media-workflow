/**
 * H.265/HEVC SPS NAL unit parser.
 */

import { BitReader } from '../binary/reader.js';
import type { HevcSpsResult, HevcProfileTierLevel, HevcVuiParams } from '../types.js';
import { removeEmulationPrevention } from '../nalu/annexb.js';
import { getChromaFormatName } from '../h264/constants.js';
import { hevcNalUnitTypeName } from './constants.js';
import { readHevcNalUnitHeader, readHevcProfileTierLevel } from './header.js';
import { parseHevcSpsVuiParameters } from './vui.js';
import { parseHevcSpsShortTermRefPicSets } from './st_rps.js';

export function parseHevcSpsNaluPayload(
  nalu: Uint8Array, baseByteOffset = 0,
  fieldOffsets: Record<string, { offset: number; length: number }> = {},
  spsIndex: number | string = 0,
): HevcSpsResult {
  if (!nalu || nalu.length < 2) return {} as HevcSpsResult;
  try {
    const s = {} as HevcSpsResult;
    const keyPrefix = typeof spsIndex === 'string' ? spsIndex : `sequenceHeader.sps[${spsIndex}]`;
    const header = nalu.slice(0, 2);
    const { data: rbsp, removedPositions } = removeEmulationPrevention(nalu.slice(2));
    const combined = new Uint8Array(header.length + rbsp.length);
    combined.set(header, 0); combined.set(rbsp, header.length);
    const adjPos = removedPositions.map(p => p + 2);
    const reader = new BitReader(combined, 0, baseByteOffset, fieldOffsets, keyPrefix, adjPos);

    const hdr = readHevcNalUnitHeader(reader);
    s.forbidden_zero_bit = hdr.forbidden_zero_bit;
    s.nal_unit_type = `${hdr.nal_unit_type} (${hevcNalUnitTypeName(hdr.nal_unit_type)})`;
    s.nalUnitTypeValue = hdr.nal_unit_type;
    s.nuh_layer_id = hdr.nuh_layer_id;
    s.nuh_temporal_id_plus1 = hdr.nuh_temporal_id_plus1;

    s.sps_video_parameter_set_id = reader.readBits(4);
    const maxSubLayers = reader.readBits(3);
    s.sps_max_sub_layers_minus1 = maxSubLayers;
    s.sps_temporal_id_nesting_flag = reader.readBits(1);
    s.profile_tier_level = readHevcProfileTierLevel(reader, keyPrefix) as HevcProfileTierLevel;
    s.sps_seq_parameter_set_id = reader.readUE();

    const chromaFmt = reader.readUE();
    s.chroma_format_idc = `${chromaFmt} (${getChromaFormatName(chromaFmt)})`;
    s.chromaFormatIdcValue = chromaFmt;
    if (chromaFmt === 3) s.separate_colour_plane_flag = reader.readBits(1);

    const picWidth = reader.readUE();
    const picHeight = reader.readUE();
    const cropFlag = reader.readBits(1);
    s.conformance_window_flag = cropFlag;

    let actualW = picWidth, actualH = picHeight;
    if (cropFlag) {
      const cL = reader.readUE(), cR = reader.readUE(), cT = reader.readUE(), cB = reader.readUE();
      s.conf_win_left_offset = cL; s.conf_win_right_offset = cR;
      s.conf_win_top_offset = cT; s.conf_win_bottom_offset = cB;
      let subW = 1, subH = 1;
      if (chromaFmt === 1) { subW = 2; subH = 2; }
      else if (chromaFmt === 2) { subW = 2; subH = 1; }
      actualW = picWidth - (cL + cR) * subW;
      actualH = picHeight - (cT + cB) * subH;
    }
    s._actualWidth = actualW;
    s._actualHeight = actualH;
    s.width = actualW;
    s.height = actualH;
    s.pic_width_in_luma_samples = `${picWidth} (actual: ${actualW})`;
    s.pic_height_in_luma_samples = `${picHeight} (actual: ${actualH})`;

    const lumaMinus8 = reader.readUE();
    s.bit_depth_luma_minus8 = `${lumaMinus8} (bit_depth: ${lumaMinus8 + 8})`;
    s.bitDepthLumaValue = lumaMinus8 + 8;
    const chromaMinus8 = reader.readUE();
    s.bit_depth_chroma_minus8 = `${chromaMinus8} (bit_depth: ${chromaMinus8 + 8})`;
    s.bitDepthChromaValue = chromaMinus8 + 8;

    s.log2_max_pic_order_cnt_lsb_minus4 = reader.readUE();

    const orderingFlag = reader.readBits(1);
    s.sps_sub_layer_ordering_info_present_flag = orderingFlag;
    const startLayer = orderingFlag ? 0 : maxSubLayers;
    for (let i = startLayer; i <= maxSubLayers; i++) {
      s[`sps_max_dec_pic_buffering_minus1[${i}]`] = reader.readUE();
      s[`sps_max_num_reorder_pics[${i}]`] = reader.readUE();
      s[`sps_max_latency_increase_plus1[${i}]`] = reader.readUE();
    }

    s.log2_min_luma_coding_block_size_minus3 = reader.readUE();
    s.log2_diff_max_min_luma_coding_block_size = reader.readUE();
    s.log2_min_luma_transform_block_size_minus2 = reader.readUE();
    s.log2_diff_max_min_luma_transform_block_size = reader.readUE();
    s.max_transform_hierarchy_depth_inter = reader.readUE();
    s.max_transform_hierarchy_depth_intra = reader.readUE();

    const scalingFlag = reader.readBits(1);
    s.scaling_list_enabled_flag = scalingFlag;
    if (scalingFlag) s.sps_scaling_list_data_present_flag = reader.readBits(1);

    s.amp_enabled_flag = reader.readBits(1);
    s.sample_adaptive_offset_enabled_flag = reader.readBits(1);

    const pcmFlag = reader.readBits(1);
    s.pcm_enabled_flag = pcmFlag;
    if (pcmFlag) {
      s.pcm_sample_bit_depth_luma_minus1 = reader.readBits(4);
      s.pcm_sample_bit_depth_chroma_minus1 = reader.readBits(4);
      s.log2_min_pcm_luma_coding_block_size_minus3 = reader.readUE();
      s.log2_diff_max_min_pcm_luma_coding_block_size = reader.readUE();
      s.pcm_loop_filter_disabled_flag = reader.readBits(1);
    }

    const numStRps = reader.readUE();
    s.num_short_term_ref_pic_sets = numStRps;
    if (numStRps > 0) parseHevcSpsShortTermRefPicSets(reader, numStRps, maxSubLayers, s, keyPrefix);

    const longTermFlag = reader.readBits(1);
    s.long_term_ref_pics_present_flag = longTermFlag;
    if (longTermFlag) s.num_long_term_ref_pics_sps = reader.readUE();

    s.sps_temporal_mvp_enabled_flag = reader.readBits(1);
    s.strong_intra_smoothing_enabled_flag = reader.readBits(1);

    const vuiFlag = reader.readBits(1);
    s.vui_parameters_present_flag = vuiFlag;
    if (vuiFlag) s.vui_parameters = parseHevcSpsVuiParameters(reader) as HevcVuiParams;

    const extFlag = reader.readBits(1);
    s.sps_extension_present_flag = extFlag;
    if (extFlag) {
      s.sps_range_extension_flag = reader.readBits(1);
      s.sps_multilayer_extension_flag = reader.readBits(1);
      s.sps_3d_extension_flag = reader.readBits(1);
      s.sps_scc_extension_flag = reader.readBits(1);
      s.sps_extension_4bits = reader.readBits(4);
      if (s.sps_range_extension_flag || s.sps_multilayer_extension_flag ||
          s.sps_3d_extension_flag || s.sps_scc_extension_flag || s.sps_extension_4bits) {
        s._note = 'SPS extension data present but not parsed';
      }
    }

    s.rbsp_stop_one_bit = reader.readBits(1);
    let idx = 0;
    while (reader.bitPosition % 8 !== 0) {
      s[`rbsp_alignment_zero_bit[${idx}]`] = reader.readBits(1);
      idx++;
    }
    return s;
  } catch (err) { /* SPS parse failure */ return { _parseError: String(err) } as HevcSpsResult; }
}

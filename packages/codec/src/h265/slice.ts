/**
 * H.265/HEVC slice segment header parser.
 */

import { BitReader } from '../binary/reader.js';
import { readHevcNalUnitHeader } from './header.js';
import { prepareRbspWithHeader } from '../nalu/utils.js';
import { parseWeightedPrediction } from '../nalu/weighted.js';

const HEVC_SLICE_TYPE_NAMES: Record<number, string> = {
  0: 'B (Bi-predictive)', 1: 'P (Predictive)', 2: 'I (Intra)',
};

function fmtSliceType(t: number): string { return HEVC_SLICE_TYPE_NAMES[t] ?? 'Unknown'; }

export function parseHevcSliceNaluPayload(
  nalu: Uint8Array,
  fieldOffsets: Record<string, { offset: number; length: number }> = {},
  naluIndex: number | string = 0,
  baseByteOffset = 0,
  spsInfo: Record<string, unknown> | null = null,
  ppsInfo: Record<string, unknown> | null = null,
): Record<string, unknown> {
  const out = {} as Record<string, unknown>;
  const prefix = typeof naluIndex === 'string' ? naluIndex : `nalu[${naluIndex}]`;

  try {
    const { combined, removedPositions, headerBytes } = prepareRbspWithHeader(nalu, 2);
    const hdrReader = new BitReader(headerBytes, 0);
    const nh = readHevcNalUnitHeader(hdrReader);
    const nalType = typeof nh.nal_unit_type === 'number' ? nh.nal_unit_type : 0;
    const reader = new BitReader(combined, 2, baseByteOffset, fieldOffsets, prefix, removedPositions);
    const isIDR = nalType === 19 || nalType === 20;
    const isSliceFamily = nalType >= 16 && nalType <= 23;

    out.first_slice_segment_in_pic_flag = reader.readBits(1, 'first_slice_segment_in_pic_flag');
    if (isSliceFamily) out.no_output_of_prior_pics_flag = reader.readBits(1, 'no_output_of_prior_pics_flag');

    const ppsId = reader.readUE('slice_pic_parameter_set_id');
    out.slice_pic_parameter_set_id = ppsId;

    const firstSlice = out.first_slice_segment_in_pic_flag as number;
    if (!firstSlice && !spsInfo) {
      (out as Record<string, unknown>)._needsReparse = true;
      return out;
    }

    const dependentEnabled = (ppsInfo?.dependent_slice_segments_enabled_flag as number) ?? 0;
    const outputFlagPresent = (ppsInfo?.output_flag_present_flag as number) ?? 0;
    const numExtraBits = (ppsInfo?.num_extra_slice_header_bits as number) ?? 0;
    const log2MaxPocLsb = (spsInfo?.log2_max_pic_order_cnt_lsb_minus4 as number) ?? 4;

    let depFlag = 0;
    if (!firstSlice && dependentEnabled) {
      depFlag = reader.readBits(1, 'dependent_slice_segment_flag');
      out.dependent_slice_segment_flag = depFlag;
    }

    if (!depFlag) {
      if (!firstSlice) {
        const picW = (spsInfo?._pic_width_in_luma_samples_value as number) ?? 1920;
        const picH = (spsInfo?._pic_height_in_luma_samples_value as number) ?? 1080;
        const addrBits = Math.min(16, Math.ceil(Math.log2((picW * picH) / 256)));
        if (addrBits > 0) out.slice_segment_address = reader.readBits(addrBits, 'slice_segment_address');
      }
      for (let i = 0; i < numExtraBits; i++) {
        out[`slice_reserved_flag[${i}]`] = reader.readBits(1, `slice_reserved_flag[${i}]`);
      }

      const sliceType = reader.readUE('slice_type');
      out.slice_type = `${sliceType} (${fmtSliceType(sliceType)})`;
      (out as Record<string, unknown>)._slice_type_value = sliceType;

      if (outputFlagPresent) out.pic_output_flag = reader.readBits(1, 'pic_output_flag');
      if ((spsInfo?.separate_colour_plane_flag as number ?? 0) !== 0) {
        out.colour_plane_id = reader.readBits(2, 'colour_plane_id');
      }

      if (!isIDR) {
        out.slice_pic_order_cnt_lsb = reader.readBits(log2MaxPocLsb + 4, 'slice_pic_order_cnt_lsb');
        const stRpsFlag = reader.readBits(1, 'short_term_ref_pic_set_sps_flag');
        out.short_term_ref_pic_set_sps_flag = stRpsFlag;
        if (!stRpsFlag) {
          const numNeg = reader.readUE('num_negative_pics');
          const numPos = reader.readUE('num_positive_pics');
          out.num_negative_pics = numNeg;
          out.num_positive_pics = numPos;
          for (let i = 0; i < (numNeg as number); i++) {
            out[`delta_poc_s0_minus1[${i}]`] = reader.readUE(`delta_poc_s0_minus1[${i}]`);
            out[`used_by_curr_pic_s0_flag[${i}]`] = reader.readBits(1, `used_by_curr_pic_s0_flag[${i}]`);
          }
          for (let i = 0; i < (numPos as number); i++) {
            out[`delta_poc_s1_minus1[${i}]`] = reader.readUE(`delta_poc_s1_minus1[${i}]`);
            out[`used_by_curr_pic_s1_flag[${i}]`] = reader.readBits(1, `used_by_curr_pic_s1_flag[${i}]`);
          }
        }
        if (spsInfo?.sps_temporal_mvp_enabled_flag as number ?? 0) {
          out.slice_temporal_mvp_enabled_flag = reader.readBits(1, 'slice_temporal_mvp_enabled_flag');
        }
      }

      if (spsInfo?.sample_adaptive_offset_enabled_flag as number ?? 0) {
        out.slice_sao_luma_flag = reader.readBits(1, 'slice_sao_luma_flag');
        if ((spsInfo?.chroma_format_idc as number ?? 1) !== 0) {
          out.slice_sao_chroma_flag = reader.readBits(1, 'slice_sao_chroma_flag');
        }
      }

      if (sliceType !== 2) {
        const overrideFlag = reader.readBits(1, 'num_ref_idx_active_override_flag');
        out.num_ref_idx_active_override_flag = overrideFlag;
        if (overrideFlag) {
          out.num_ref_idx_l0_active_minus1 = reader.readUE('num_ref_idx_l0_active_minus1');
          if (sliceType === 0) out.num_ref_idx_l1_active_minus1 = reader.readUE('num_ref_idx_l1_active_minus1');
        }
        const listsMod = (ppsInfo?.lists_modification_present_flag as number) ?? 0;
        const stRpsSize = ((out.num_negative_pics as number) ?? 0) + ((out.num_positive_pics as number) ?? 0);
        if (listsMod && stRpsSize > 1) {
          out.ref_pic_list_modification_flag_l0 = reader.readBits(1, 'ref_pic_list_modification_flag_l0');
          if (sliceType === 0) {
            out.ref_pic_list_modification_flag_l1 = reader.readBits(1, 'ref_pic_list_modification_flag_l1');
          }
        }
      }

      if (sliceType === 0) out.mvd_l1_zero_flag = reader.readBits(1, 'mvd_l1_zero_flag');
      if (sliceType !== 2 && ((ppsInfo?.cabac_init_present_flag as number) ?? 0) !== 0) {
        out.cabac_init_flag = reader.readBits(1, 'cabac_init_flag');
      }

      if (out.slice_temporal_mvp_enabled_flag) {
        let collocatedFromL0 = 1;
        if (sliceType === 0) {
          collocatedFromL0 = reader.readBits(1, 'collocated_from_l0_flag');
          out.collocated_from_l0_flag = collocatedFromL0;
        }
        const nL0 = (out.num_ref_idx_l0_active_minus1 as number) ??
          (ppsInfo?.num_ref_idx_l0_default_active_minus1 as number) ?? 0;
        const nL1 = (out.num_ref_idx_l1_active_minus1 as number) ??
          (ppsInfo?.num_ref_idx_l1_default_active_minus1 as number) ?? 0;
        if ((collocatedFromL0 && nL0 > 0) || (!collocatedFromL0 && nL1 > 0)) {
          out.collocated_ref_idx = reader.readUE('collocated_ref_idx');
        }
      }

      if (sliceType !== 2) {
        const wpred = (ppsInfo?.weighted_pred_flag as number) ?? 0;
        const wbipred = (ppsInfo?.weighted_bipred_flag as number) ?? 0;
        if ((wpred && sliceType === 1) || (wbipred && sliceType === 0)) {
          const numRefL0 = (out.num_ref_idx_l0_active_minus1 as number) ??
            (ppsInfo?.num_ref_idx_l0_default_active_minus1 as number) ?? 0;
          const numRefL1 = (out.num_ref_idx_l1_active_minus1 as number) ??
            (ppsInfo?.num_ref_idx_l1_default_active_minus1 as number) ?? 0;
          parseWeightedPrediction(reader, out, {
            sliceType,
            weightedPredFlag: wpred === 1,
            weightedBipredFlag: wbipred === 1,
            weightIsDelta: true,
            chromaFormatIdc: (spsInfo?._chroma_format_idc_value as number) ?? 1,
            numRefL0, numRefL1,
          });
        }
      }

      if (sliceType !== 2) out.five_minus_max_num_merge_cand = reader.readUE('five_minus_max_num_merge_cand');
      out.slice_qp_delta = reader.readSE('slice_qp_delta');

      if ((ppsInfo?.pps_slice_chroma_qp_offsets_present_flag as number) ?? 0) {
        out.slice_cb_qp_offset = reader.readSE('slice_cb_qp_offset');
        out.slice_cr_qp_offset = reader.readSE('slice_cr_qp_offset');
      }

      if ((ppsInfo?.deblocking_filter_override_enabled_flag as number) ?? 0) {
        const dfo = reader.readBits(1, 'deblocking_filter_override_flag');
        out.deblocking_filter_override_flag = dfo;
        if (dfo) {
          const sdf = reader.readBits(1, 'slice_deblocking_filter_disabled_flag');
          out.slice_deblocking_filter_disabled_flag = sdf;
          if (!sdf) {
            out.slice_beta_offset_div2 = reader.readSE('slice_beta_offset_div2');
            out.slice_tc_offset_div2 = reader.readSE('slice_tc_offset_div2');
          }
        }
      }

      if ((ppsInfo?.pps_loop_filter_across_slices_enabled_flag as number) ?? 0) {
        out.slice_loop_filter_across_slices_enabled_flag = reader.readBits(1, 'slice_loop_filter_across_slices_enabled_flag');
      }

      // Alignment
      if (reader.bitPosition < combined.length * 8) {
        out.alignment_bit_equal_to_one = reader.readBits(1, 'alignment_bit_equal_to_one');
        let z = 0;
        while (reader.bitPosition % 8 !== 0 && reader.bitPosition < combined.length * 8) {
          out[`alignment_bit_equal_to_zero[${z}]`] = reader.readBits(1, `alignment_bit_equal_to_zero[${z}]`);
          z++;
        }
      }
    }
  } catch (err) {
    (out as Record<string, unknown>)._parseError = err instanceof Error ? err.message : String(err);
  }

  return out;
}

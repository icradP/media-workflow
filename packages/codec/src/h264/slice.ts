/**
 * H.264 slice_header parser (NAL types 1, 5).
 */

import { BitReader } from '../binary/reader.js';
import type { H264SliceResult } from '../types.js';
import { getSliceTypeName } from './constants.js';
import { readH264NalUnitHeader } from './sps.js';
import { prepareRbspWithHeader } from '../nalu/utils.js';
import { parseWeightedPrediction } from '../nalu/weighted.js';

export function parseH264SliceNaluPayload(
  nalu: Uint8Array,
  fieldOffsets: Record<string, { offset: number; length: number }> = {},
  naluIndex: number | string = 0,
  baseByteOffset = 0,
  sps: Record<string, unknown> | null = null,
  pps: Record<string, unknown> | null = null,
): H264SliceResult {
  const o = {} as H264SliceResult;
  const keyPrefix = typeof naluIndex === 'string' ? naluIndex : `nalu[${naluIndex}]`;

  try {
    const { combined, removedPositions, headerBytes } = prepareRbspWithHeader(nalu, 1);
    const headerReader = new BitReader(headerBytes, 0, 0, undefined, '');
    const nalHdr = readH264NalUnitHeader(headerReader);
    const nalRefIdc = nalHdr.nal_ref_idc;
    const nalUnitType = nalHdr.nal_unit_type;
    const isIdr = (typeof nalUnitType === 'number' ? nalUnitType : 0) === 5;

    const reader = new BitReader(combined, 1, baseByteOffset, fieldOffsets, keyPrefix, removedPositions);

    o.first_mb_in_slice = reader.readUE('first_mb_in_slice');
    const sliceType = reader.readUE('slice_type');
    o.slice_type = `${sliceType} (${getSliceTypeName(sliceType)})`;
    (o as H264SliceResult)._slice_type_value = sliceType;
    o.pic_parameter_set_id = reader.readUE('pic_parameter_set_id');

    if (!sps) {
      (o as H264SliceResult)._needsReparse = true;
      (o as H264SliceResult)._parseIncomplete = 'Missing SPS info';
      return o;
    }

    const frameMbsOnly = (sps.frame_mbs_only_flag as number) ?? 1;
    const separateColourPlane = (sps.separate_colour_plane_flag as number) ?? 0;
    const pocType = (sps.pic_order_cnt_type as number) ?? 0;
    const log2MaxFrameNum = (sps.log2_max_frame_num_minus4 as number) ?? 0;
    const log2MaxPocLsb = (sps.log2_max_pic_order_cnt_lsb_minus4 as number) ?? 0;
    const deltaPicOrderAlwaysZero = (sps.delta_pic_order_always_zero_flag as number) ?? 0;
    const entropyCodingMode = (pps?._entropy_coding_mode_flag_value as number) ?? 0;
    const bottomFieldPicOrder = (pps?.bottom_field_pic_order_in_frame_present_flag as number) ?? 0;
    const redundantPicCnt = (pps?.redundant_pic_cnt_present_flag as number) ?? 0;
    const deblockingFilter = (pps?.deblocking_filter_control_present_flag as number) ?? 1;
    const numSliceGroups = (pps?.num_slice_groups_minus1 as number) ?? 0;
    const weightedPredFlag = (pps?.weighted_pred_flag as number) ?? 0;
    const weightedBipredIdc = (pps?._weighted_bipred_idc_value as number) ?? 0;

    if (separateColourPlane === 1) o.colour_plane_id = reader.readBits(2, 'colour_plane_id');

    const frameNumBits = log2MaxFrameNum + 4;
    o.frame_num = reader.readBits(frameNumBits, 'frame_num');

    let fieldPicFlag = 0;
    if (frameMbsOnly === 0) {
      fieldPicFlag = reader.readBits(1, 'field_pic_flag');
      o.field_pic_flag = fieldPicFlag;
      if (fieldPicFlag === 1) o.bottom_field_flag = reader.readBits(1, 'bottom_field_flag');
    }

    if (isIdr) o.idr_pic_id = reader.readUE('idr_pic_id');

    if (pocType === 0) {
      const pocLsbBits = log2MaxPocLsb + 4;
      o.pic_order_cnt_lsb = reader.readBits(pocLsbBits, 'pic_order_cnt_lsb');
      if (bottomFieldPicOrder === 1 && fieldPicFlag === 0) {
        o.delta_pic_order_cnt_bottom = reader.readSE('delta_pic_order_cnt_bottom');
      }
    }

    if (pocType === 1 && deltaPicOrderAlwaysZero === 0) {
      o.delta_pic_order_cnt_0 = reader.readSE('delta_pic_order_cnt_0');
      if (bottomFieldPicOrder === 1 && fieldPicFlag === 0) {
        o.delta_pic_order_cnt_1 = reader.readSE('delta_pic_order_cnt_1');
      }
    }

    if (redundantPicCnt === 1) o.redundant_pic_cnt = reader.readUE('redundant_pic_cnt');

    const sliceTypeMod = sliceType % 5;
    if (sliceTypeMod === 1) {
      o.direct_spatial_mv_pred_flag = reader.readBits(1, 'direct_spatial_mv_pred_flag');
    }

    if (sliceTypeMod === 0 || sliceTypeMod === 1 || sliceTypeMod === 3) {
      const overrideFlag = reader.readBits(1, 'num_ref_idx_active_override_flag');
      o.num_ref_idx_active_override_flag = overrideFlag;
      if (overrideFlag === 1) {
        o.num_ref_idx_l0_active_minus1 = reader.readUE('num_ref_idx_l0_active_minus1');
        if (sliceTypeMod === 1) {
          o.num_ref_idx_l1_active_minus1 = reader.readUE('num_ref_idx_l1_active_minus1');
        }
      }
    }

    if (sliceTypeMod !== 2 && sliceTypeMod !== 4) {
      const l0ModFlag = reader.readBits(1, 'ref_pic_list_modification_flag_l0');
      o.ref_pic_list_modification_flag_l0 = l0ModFlag;
      if (l0ModFlag === 1) {
        let idc: number;
        let idx = 0;
        do {
          idc = reader.readUE(`modification_of_pic_nums_idc[${idx}]`);
          o[`modification_of_pic_nums_idc[${idx}]`] = idc;
          if (idc === 0 || idc === 1) {
            o[`abs_diff_pic_num_minus1[${idx}]`] = reader.readUE(`abs_diff_pic_num_minus1[${idx}]`);
          } else if (idc === 2) {
            o[`long_term_pic_num[${idx}]`] = reader.readUE(`long_term_pic_num[${idx}]`);
          }
          idx++;
        } while (idc !== 3 && idx < 100);
      }
      if (sliceTypeMod === 1) {
        const l1ModFlag = reader.readBits(1, 'ref_pic_list_modification_flag_l1');
        o.ref_pic_list_modification_flag_l1 = l1ModFlag;
        if (l1ModFlag === 1) {
          let idc: number;
          let idx = 0;
          do {
            idc = reader.readUE(`modification_of_pic_nums_idc_l1[${idx}]`);
            o[`modification_of_pic_nums_idc_l1[${idx}]`] = idc;
            if (idc === 0 || idc === 1) {
              o[`abs_diff_pic_num_minus1_l1[${idx}]`] = reader.readUE(`abs_diff_pic_num_minus1_l1[${idx}]`);
            } else if (idc === 2) {
              o[`long_term_pic_num_l1[${idx}]`] = reader.readUE(`long_term_pic_num_l1[${idx}]`);
            }
            idx++;
          } while (idc !== 3 && idx < 100);
        }
      }
    }

    if ((weightedPredFlag === 1 && (sliceTypeMod === 0 || sliceTypeMod === 3)) ||
        (weightedBipredIdc === 1 && sliceTypeMod === 1)) {
      const numRefL0 = o.num_ref_idx_l0_active_minus1 !== undefined
        ? (o.num_ref_idx_l0_active_minus1 as number)
        : ((pps?.num_ref_idx_l0_default_active_minus1 as number) ?? 0);
      const numRefL1 = o.num_ref_idx_l1_active_minus1 !== undefined
        ? (o.num_ref_idx_l1_active_minus1 as number)
        : ((pps?.num_ref_idx_l1_default_active_minus1 as number) ?? 0);
      parseWeightedPrediction(reader, o, {
        sliceType: sliceTypeMod,
        weightedPredFlag: weightedPredFlag === 1,
        weightedBipredFlag: weightedBipredIdc === 1,
        checkBitDepthChroma: true,
        bitDepthChroma: separateColourPlane,
        chromaFormatIdc: (sps._chroma_format_idc_value as number) ?? 1,
        numRefL0,
        numRefL1,
      });
    }

    if (nalRefIdc !== 0) {
      if (isIdr) {
        o.no_output_of_prior_pics_flag = reader.readBits(1, 'no_output_of_prior_pics_flag');
        o.long_term_reference_flag = reader.readBits(1, 'long_term_reference_flag');
      } else {
        const mmcoFlag = reader.readBits(1, 'adaptive_ref_pic_marking_mode_flag');
        o.adaptive_ref_pic_marking_mode_flag = mmcoFlag;
        if (mmcoFlag === 1) {
          let op: number;
          let idx = 0;
          do {
            op = reader.readUE(`memory_management_control_operation[${idx}]`);
            o[`memory_management_control_operation[${idx}]`] = op;
            if (op === 1 || op === 3) {
              o[`difference_of_pic_nums_minus1[${idx}]`] = reader.readUE(`difference_of_pic_nums_minus1[${idx}]`);
            }
            if (op === 2) {
              o[`long_term_pic_num[${idx}]`] = reader.readUE(`long_term_pic_num[${idx}]`);
            }
            if (op === 3 || op === 6) {
              o[`long_term_frame_idx[${idx}]`] = reader.readUE(`long_term_frame_idx[${idx}]`);
            }
            if (op === 4) {
              o[`max_long_term_frame_idx_plus1[${idx}]`] = reader.readUE(`max_long_term_frame_idx_plus1[${idx}]`);
            }
            idx++;
          } while (op !== 0 && idx < 100);
        }
      }
    }

    if (entropyCodingMode === 1 && sliceTypeMod !== 2 && sliceTypeMod !== 4) {
      o.cabac_init_idc = reader.readUE('cabac_init_idc');
    }

    o.slice_qp_delta = reader.readSE('slice_qp_delta');

    if (sliceTypeMod === 3 || sliceTypeMod === 4) {
      if (sliceTypeMod === 3) o.sp_for_switch_flag = reader.readBits(1, 'sp_for_switch_flag');
      o.slice_qs_delta = reader.readSE('slice_qs_delta');
    }

    if (deblockingFilter === 1) {
      const dfIdc = reader.readUE('disable_deblocking_filter_idc');
      o.disable_deblocking_filter_idc = dfIdc;
      if (dfIdc !== 1) {
        o.slice_alpha_c0_offset_div2 = reader.readSE('slice_alpha_c0_offset_div2');
        o.slice_beta_offset_div2 = reader.readSE('slice_beta_offset_div2');
      }
    }

    if (numSliceGroups > 0) {
      const mapUnits = (pps?.slice_groups as Record<string, unknown>)?.pic_size_in_map_units_minus1 as number ?? 0;
      const bits = Math.ceil(Math.log2(mapUnits + 1));
      if (bits > 0) o.slice_group_change_cycle = reader.readBits(bits, 'slice_group_change_cycle');
    }

    if (entropyCodingMode === 1) {
      let idx = 0;
      while (reader.bitPosition % 8 !== 0) {
        o[`cabac_alignment_one_bit[${idx}]`] = reader.readBits(1, `cabac_alignment_one_bit[${idx}]`);
        idx++;
      }
    }
  } catch (err) {
    (o as H264SliceResult)._parseError = err instanceof Error ? err.message : String(err);
  }

  return o;
}

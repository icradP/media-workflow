/**
 * H.264 SPS NAL unit RBSP parser.
 *
 * Parses a single SPS NAL unit (1-byte header + RBSP, possibly with emulation prevention).
 * Returns a strongly-typed H264SpsResult.
 */

import { BitReader } from '../binary/reader.js';
import { removeEmulationPrevention } from '../nalu/annexb.js';
import type { H264SpsResult, H264VuiParams, H264TimingInfo, HrdParams } from '../types.js';
import {
  getAVCProfileName,
  getAVCLevelName,
  getChromaFormatName,
  HIGH_PROFILE_IDS,
} from './constants.js';

// ─── NAL header ───

export interface H264NalHeader {
  forbidden_zero_bit: number;
  nal_ref_idc: number;
  nal_unit_type: number;
}

export function readH264NalUnitHeader(reader: BitReader): H264NalHeader {
  return {
    forbidden_zero_bit: reader.readBits(1, 'forbidden_zero_bit'),
    nal_ref_idc: reader.readBits(2, 'nal_ref_idc'),
    nal_unit_type: reader.readBits(5, 'nal_unit_type'),
  };
}

// ─── VUI lookup tables ───

const VUI_ASPECT_RATIO: Record<number, string> = {
  0: 'Unspecified', 1: '1:1 (Square)', 2: '12:11', 3: '10:11', 4: '16:11',
  5: '40:33', 6: '24:11', 7: '20:11', 8: '32:11', 9: '80:33',
  10: '18:11', 11: '15:11', 12: '64:33', 13: '160:99', 14: '4:3',
  15: '3:2', 16: '2:1', 255: 'Extended_SAR',
};

const VUI_VIDEO_FMT: Record<number, string> = {
  0: 'Component', 1: 'PAL', 2: 'NTSC', 3: 'SECAM', 4: 'MAC', 5: 'Unspecified',
};

const VUI_PRIMARIES: Record<number, string> = {
  1: 'BT.709', 2: 'Unspecified', 4: 'BT.470M', 5: 'BT.470BG',
  6: 'SMPTE 170M', 7: 'SMPTE 240M', 8: 'FILM', 9: 'BT.2020',
  10: 'SMPTE ST 428', 11: 'DCI-P3', 12: 'Display P3',
};

const VUI_TRANSFER: Record<number, string> = {
  1: 'BT.709', 4: 'BT.470M', 5: 'BT.470BG', 6: 'SMPTE 170M',
  7: 'SMPTE 240M', 8: 'Linear', 9: 'Log 100:1', 10: 'Log 316:1',
  11: 'IEC 61966-2-4', 12: 'BT.1361', 13: 'IEC 61966-2-1 (sRGB)',
  14: 'BT.2020 10-bit', 15: 'BT.2020 12-bit', 16: 'SMPTE ST 2084 (PQ)',
  17: 'SMPTE ST 428', 18: 'ARIB STD-B67 (HLG)',
};

const VUI_MATRIX: Record<number, string> = {
  0: 'Identity', 1: 'BT.709', 4: 'FCC', 5: 'BT.470BG',
  6: 'SMPTE 170M', 7: 'SMPTE 240M', 8: 'YCgCo', 9: 'BT.2020 NCL',
  10: 'BT.2020 CL', 11: 'SMPTE ST 2085', 12: 'Chroma NCL', 13: 'Chroma CL', 14: 'ICtCp',
};

// ─── Sub-parsers ───

function parseH264HrdParameters(reader: BitReader): HrdParams {
  const cpbCnt = reader.readUE('cpb_cnt_minus1');
  const specs: HrdParams['cpb_specs'] = [];
  for (let s = 0; s <= cpbCnt; s++) {
    const prev = reader.prefix;
    reader.prefix = `${prev}.cpb_specs[${s}]`;
    specs.push({
      bit_rate_value_minus1: reader.readUE('bit_rate_value_minus1'),
      cpb_size_value_minus1: reader.readUE('cpb_size_value_minus1'),
      cbr_flag: reader.readBits(1, 'cbr_flag'),
    });
    reader.prefix = prev;
  }
  return {
    cpb_cnt_minus1: cpbCnt,
    bit_rate_scale: reader.readBits(4, 'bit_rate_scale'),
    cpb_size_scale: reader.readBits(4, 'cpb_size_scale'),
    cpb_specs: specs,
    initial_cpb_removal_delay_length_minus1: reader.readBits(5, 'initial_cpb_removal_delay_length_minus1'),
    cpb_removal_delay_length_minus1: reader.readBits(5, 'cpb_removal_delay_length_minus1'),
    dpb_output_delay_length_minus1: reader.readBits(5, 'dpb_output_delay_length_minus1'),
    time_offset_length: reader.readBits(5, 'time_offset_length'),
  };
}

function parseH264VuiParameters(reader: BitReader): H264VuiParams {
  const prevOuter = reader.prefix;
  reader.prefix = prevOuter ? `${prevOuter}.vui_parameters` : 'vui_parameters';
  const a = {} as H264VuiParams;

  const arFlag = reader.readBits(1, 'aspect_ratio_info_present_flag');
  a.aspect_ratio_info_present_flag = arFlag;
  if (arFlag) {
    const idc = reader.readBits(8, 'aspect_ratio_idc');
    a.aspect_ratio_idc = `${idc} (${VUI_ASPECT_RATIO[idc] ?? 'Reserved'})`;
    a[idc === 255 ? '_aspect_ratio_idc_value' : ''] = idc; // transient
    if (idc === 255) { a.sar_width = reader.readBits(16, 'sar_width'); a.sar_height = reader.readBits(16, 'sar_height'); }
  }

  const overscanFlag = reader.readBits(1, 'overscan_info_present_flag');
  a.overscan_info_present_flag = overscanFlag;
  if (overscanFlag) {
    const prev = reader.prefix; reader.prefix = `${prev}.overscan_info`;
    a.overscan_info = { overscan_appropriate_flag: reader.readBits(1, 'overscan_appropriate_flag') };
    reader.prefix = prev;
  }

  const vsFlag = reader.readBits(1, 'video_signal_type_present_flag');
  a.video_signal_type_present_flag = vsFlag;
  if (vsFlag) {
    const prev = reader.prefix; reader.prefix = `${prev}.video_signal_type`;
    const fmt = reader.readBits(3, 'video_format');
    const vs: H264VuiParams['video_signal_type'] = {
      video_format: `${fmt} (${VUI_VIDEO_FMT[fmt] ?? 'Unknown'})`,
      video_full_range_flag: reader.readBits(1, 'video_full_range_flag'),
      colour_description_present_flag: 0,
    };
    const cdFlag = reader.readBits(1, 'colour_description_present_flag');
    vs.colour_description_present_flag = cdFlag;
    if (cdFlag) {
      const prev2 = reader.prefix; reader.prefix = `${prev2}.colour_description`;
      const cp = reader.readBits(8, 'colour_primaries');
      const tc = reader.readBits(8, 'transfer_characteristics');
      const mc = reader.readBits(8, 'matrix_coefficients');
      vs.colour_description = {
        colour_primaries: `${cp} (${VUI_PRIMARIES[cp] ?? 'Unspecified'})`,
        transfer_characteristics: `${tc} (${VUI_TRANSFER[tc] ?? 'Unspecified'})`,
        matrix_coefficients: `${mc} (${VUI_MATRIX[mc] ?? 'Unknown'})`,
      };
      reader.prefix = prev2;
    }
    reader.prefix = prev;
    a.video_signal_type = vs;
  }

  const chromaFlag = reader.readBits(1, 'chroma_loc_info_present_flag');
  a.chroma_loc_info_present_flag = chromaFlag;
  if (chromaFlag) {
    const prev = reader.prefix; reader.prefix = `${prev}.chroma_loc_info`;
    a.chroma_loc_info = {
      chroma_sample_loc_type_top_field: reader.readUE('chroma_sample_loc_type_top_field'),
      chroma_sample_loc_type_bottom_field: reader.readUE('chroma_sample_loc_type_bottom_field'),
    };
    reader.prefix = prev;
  }

  const timingFlag = reader.readBits(1, 'timing_info_present_flag');
  a.timing_info_present_flag = timingFlag;
  if (timingFlag) {
    const prev = reader.prefix; reader.prefix = `${prev}.timing_info`;
    const unitsInTick = reader.readBits(32, 'num_units_in_tick') >>> 0;
    const timeScale = reader.readBits(32, 'time_scale') >>> 0;
    const ti: H264TimingInfo = {
      num_units_in_tick: unitsInTick,
      time_scale: timeScale,
      fixed_frame_rate_flag: reader.readBits(1, 'fixed_frame_rate_flag'),
    };
    if (unitsInTick > 0) ti.calculated_frame_rate = `${(timeScale / (2 * unitsInTick)).toFixed(3)} fps`;
    reader.prefix = prev;
    a.timing_info = ti;
  }

  const nalHrdFlag = reader.readBits(1, 'nal_hrd_parameters_present_flag');
  a.nal_hrd_parameters_present_flag = nalHrdFlag;
  if (nalHrdFlag) {
    const prev = reader.prefix; reader.prefix = `${prev}.nal_hrd_parameters`;
    a.nal_hrd_parameters = parseH264HrdParameters(reader);
    reader.prefix = prev;
  }

  const vclHrdFlag = reader.readBits(1, 'vcl_hrd_parameters_present_flag');
  a.vcl_hrd_parameters_present_flag = vclHrdFlag;
  if (vclHrdFlag) {
    const prev = reader.prefix; reader.prefix = `${prev}.vcl_hrd_parameters`;
    a.vcl_hrd_parameters = parseH264HrdParameters(reader);
    reader.prefix = prev;
  }

  if (nalHrdFlag || vclHrdFlag) a.low_delay_hrd_flag = reader.readBits(1, 'low_delay_hrd_flag');
  a.pic_struct_present_flag = reader.readBits(1, 'pic_struct_present_flag');

  const brFlag = reader.readBits(1, 'bitstream_restriction_flag');
  a.bitstream_restriction_flag = brFlag;
  if (brFlag) {
    const prev = reader.prefix; reader.prefix = `${prev}.bitstream_restriction`;
    a.bitstream_restriction = {
      motion_vectors_over_pic_boundaries_flag: reader.readBits(1, 'motion_vectors_over_pic_boundaries_flag'),
      max_bytes_per_pic_denom: reader.readUE('max_bytes_per_pic_denom'),
      max_bits_per_mb_denom: reader.readUE('max_bits_per_mb_denom'),
      log2_max_mv_length_horizontal: reader.readUE('log2_max_mv_length_horizontal'),
      log2_max_mv_length_vertical: reader.readUE('log2_max_mv_length_vertical'),
      max_num_reorder_frames: reader.readUE('max_num_reorder_frames'),
      max_dec_frame_buffering: reader.readUE('max_dec_frame_buffering'),
    };
    reader.prefix = prev;
  }

  reader.prefix = prevOuter;
  return a;
}

// ─── Empty SPS (for error returns) ───

function emptySps(): H264SpsResult {
  return {
    forbidden_zero_bit: 0, nal_ref_idc: 0, nal_unit_type: 0,
    profile_idc: '', profileIdcValue: 0,
    constraint_set0_flag: 0, constraint_set1_flag: 0, constraint_set2_flag: 0,
    constraint_set3_flag: 0, constraint_set4_flag: 0, constraint_set5_flag: 0,
    reserved_zero_2bits: 0,
    level_idc: '', levelIdcValue: 0,
    seq_parameter_set_id: 0,
    chroma_format_idc: '', chromaFormatIdcValue: 1,
    bit_depth_luma_minus8: '', bitDepthLumaValue: 8,
    bit_depth_chroma_minus8: '', bitDepthChromaValue: 8,
    log2_max_frame_num_minus4: 0,
    pic_order_cnt_type: 0,
    max_num_ref_frames: 0,
    gaps_in_frame_num_allowed_flag: 0,
    pic_width_in_mbs_minus1: '',
    picHeightInMapUnitsMinus1: '',
    frame_mbs_only_flag: 0,
    direct_8x8_inference_flag: 0,
    frame_cropping_flag: 0,
    width: 0, height: 0,
    vui_parameters_present_flag: 0,
    _actualWidth: 0, _actualHeight: 0,
    _profile_idc_value: 0, _level_idc_value: 0,
    _chroma_format_idc_value: 1,
    _bit_depth_luma_value: 8, _bit_depth_chroma_value: 8,
    _pic_width_in_mbs_minus1_value: 0, _pic_height_in_map_units_minus1_value: 0,
  };
}

// ─── Main SPS parser ───

export function parseH264SpsNaluPayload(
  nalu: Uint8Array,
  baseByteOffset = 0,
  fieldOffsets: Record<string, { offset: number; length: number }> = {},
  spsIndex: number | string = 0,
): H264SpsResult {
  if (!nalu || nalu.length < 4) return emptySps();

  const s = emptySps();
  const keyPrefix = typeof spsIndex === 'string' ? spsIndex : `sequenceHeader.sps[${spsIndex}]`;

  try {
    // NAL header + RBSP
    const headerByte = nalu.slice(0, 1);
    const { data: rbsp, removedPositions } = removeEmulationPrevention(nalu.slice(1));
    const combined = new Uint8Array(headerByte.length + rbsp.length);
    combined.set(headerByte, 0);
    combined.set(rbsp, headerByte.length);

    const reader = new BitReader(
      combined, 0, baseByteOffset, fieldOffsets, keyPrefix,
      removedPositions.map(p => p + 1),
    );

    const nalHeader = readH264NalUnitHeader(reader);
    s.forbidden_zero_bit = nalHeader.forbidden_zero_bit;
    s.nal_ref_idc = nalHeader.nal_ref_idc;
    s.nal_unit_type = nalHeader.nal_unit_type;

    if (fieldOffsets) {
      fieldOffsets[`${keyPrefix}._nalUnitHeader_byte`] = { offset: baseByteOffset, length: 1 };
    }

    // Profile / Level
    const profileIdc = reader.readBits(8, 'profile_idc');
    s.profile_idc = `${profileIdc} (${getAVCProfileName(profileIdc)})`;
    s.profileIdcValue = profileIdc;
    s._profile_idc_value = profileIdc;

    s.constraint_set0_flag = reader.readBits(1, 'constraint_set0_flag');
    s.constraint_set1_flag = reader.readBits(1, 'constraint_set1_flag');
    s.constraint_set2_flag = reader.readBits(1, 'constraint_set2_flag');
    s.constraint_set3_flag = reader.readBits(1, 'constraint_set3_flag');
    s.constraint_set4_flag = reader.readBits(1, 'constraint_set4_flag');
    s.constraint_set5_flag = reader.readBits(1, 'constraint_set5_flag');
    s.reserved_zero_2bits = reader.readBits(2, 'reserved_zero_2bits');

    const levelIdc = reader.readBits(8, 'level_idc');
    s.level_idc = `${levelIdc} (${getAVCLevelName(levelIdc)})`;
    s.levelIdcValue = levelIdc;
    s._level_idc_value = levelIdc;

    const rbspStartByte = Math.floor(reader.bitPosition / 8);
    s.seq_parameter_set_id = reader.readUE('seq_parameter_set_id');

    // High profile extensions
    let chromaFmtVal = 1;
    let bitDepthLuma = 8;

    if (HIGH_PROFILE_IDS.includes(profileIdc)) {
      const chromaFmt = reader.readUE('chroma_format_idc');
      s.chroma_format_idc = `${chromaFmt} (${getChromaFormatName(chromaFmt)})`;
      chromaFmtVal = chromaFmt;
      s.chromaFormatIdcValue = chromaFmt;
      s._chroma_format_idc_value = chromaFmt;

      if (chromaFmt === 3) s.separate_colour_plane_flag = reader.readBits(1, 'separate_colour_plane_flag');

      const lumaMinus8 = reader.readUE('bit_depth_luma_minus8');
      bitDepthLuma = lumaMinus8 + 8;
      s.bit_depth_luma_minus8 = `${lumaMinus8} (bit_depth: ${bitDepthLuma})`;
      s.bitDepthLumaValue = bitDepthLuma;
      s._bit_depth_luma_value = bitDepthLuma;

      const chromaMinus8 = reader.readUE('bit_depth_chroma_minus8');
      const bitDepthChroma = chromaMinus8 + 8;
      s.bit_depth_chroma_minus8 = `${chromaMinus8} (bit_depth: ${bitDepthChroma})`;
      s.bitDepthChromaValue = bitDepthChroma;
      s._bit_depth_chroma_value = bitDepthChroma;

      s.qpprime_y_zero_transform_bypass_flag = reader.readBits(1, 'qpprime_y_zero_transform_bypass_flag');

      const scalingFlag = reader.readBits(1, 'seq_scaling_matrix_present_flag');
      s.seq_scaling_matrix_present_flag = scalingFlag;
      if (scalingFlag) {
        const numLists = chromaFmt !== 3 ? 8 : 12;
        for (let i = 0; i < numLists; i++) {
          const listFlag = reader.readBits(1, `seq_scaling_list[${i}].seq_scaling_list_present_flag`);
          const entry = { seq_scaling_list_present_flag: listFlag, scalingList: [] as number[] };
          if (listFlag) {
            const sizeOfScalingList = i < 6 ? 16 : 64;
            let lastScale = 8, nextScale = 8;
            for (let j = 0; j < sizeOfScalingList; j++) {
              if (nextScale !== 0) {
                const delta = reader.readSE();
                nextScale = (lastScale + delta + 256) % 256;
              }
              lastScale = nextScale === 0 ? lastScale : nextScale;
              entry.scalingList.push(lastScale);
            }
          }
          s[`seq_scaling_list[${i}]`] = entry;
        }
      }
    }

    s.log2_max_frame_num_minus4 = reader.readUE('log2_max_frame_num_minus4');

    // POC
    const pocType = reader.readUE('pic_order_cnt_type');
    s.pic_order_cnt_type = pocType;
    if (pocType === 0) {
      s.log2_max_pic_order_cnt_lsb_minus4 = reader.readUE('log2_max_pic_order_cnt_lsb_minus4');
    } else if (pocType === 1) {
      s.delta_pic_order_always_zero_flag = reader.readBits(1, 'delta_pic_order_always_zero_flag');
      s.offset_for_non_ref_pic = reader.readSE('offset_for_non_ref_pic');
      s.offset_for_top_to_bottom_field = reader.readSE('offset_for_top_to_bottom_field');
      const numRefFrames = reader.readUE('num_ref_frames_in_pic_order_cnt_cycle');
      s.num_ref_frames_in_pic_order_cnt_cycle = numRefFrames;
      const offsets: number[] = [];
      for (let i = 0; i < numRefFrames; i++) offsets.push(reader.readSE(`offset_for_ref_frame[${i}]`));
      if (offsets.length > 0) s.offset_for_ref_frame = offsets;
    }

    s.max_num_ref_frames = reader.readUE('max_num_ref_frames');
    s.gaps_in_frame_num_allowed_flag = reader.readBits(1, 'gaps_in_frame_num_allowed_flag');

    // Resolution
    const picWidthMbs = reader.readUE('pic_width_in_mbs_minus1');
    const codedWidth = (picWidthMbs + 1) * 16;
    s._pic_width_in_mbs_minus1_value = picWidthMbs;

    const picHeightMap = reader.readUE('pic_height_in_map_units_minus1');
    const mapUnits = picHeightMap + 1;
    s._pic_height_in_map_units_minus1_value = picHeightMap;

    const frameMbsOnly = reader.readBits(1, 'frame_mbs_only_flag');
    s.frame_mbs_only_flag = frameMbsOnly;
    const codedHeight = mapUnits * (frameMbsOnly ? 1 : 2) * 16;

    if (!frameMbsOnly) s.mb_adaptive_frame_field_flag = reader.readBits(1, 'mb_adaptive_frame_field_flag');
    s.direct_8x8_inference_flag = reader.readBits(1, 'direct_8x8_inference_flag');

    // Cropping
    const cropFlag = reader.readBits(1, 'frame_cropping_flag');
    s.frame_cropping_flag = cropFlag;

    let actualWidth = codedWidth;
    let actualHeight = codedHeight;

    if (cropFlag) {
      const cropLeft = reader.readUE('frame_crop_left_offset');
      const cropRight = reader.readUE('frame_crop_right_offset');
      const cropTop = reader.readUE('frame_crop_top_offset');
      const cropBottom = reader.readUE('frame_crop_bottom_offset');
      s.frame_crop_left_offset = cropLeft;
      s.frame_crop_right_offset = cropRight;
      s.frame_crop_top_offset = cropTop;
      s.frame_crop_bottom_offset = cropBottom;

      let subW = 2, subH = 2;
      if (chromaFmtVal === 1) { subW = 2; subH = 2; }
      else if (chromaFmtVal === 2) { subW = 2; subH = 1; }
      else if (chromaFmtVal === 3) { subW = 1; subH = 1; }

      const cropUnitY = subH * (frameMbsOnly ? 1 : 2);
      actualWidth = codedWidth - (cropLeft + cropRight) * subW;
      actualHeight = codedHeight - (cropTop + cropBottom) * cropUnitY;

      s.pic_width_in_mbs_minus1 = `${picWidthMbs} (actual: ${actualWidth})`;
      s.picHeightInMapUnitsMinus1 = `${picHeightMap} (actual: ${actualHeight})`;
    } else {
      s.pic_width_in_mbs_minus1 = `${picWidthMbs} (actual: ${actualWidth})`;
      s.picHeightInMapUnitsMinus1 = `${picHeightMap} (actual: ${actualHeight})`;
    }

    s.width = actualWidth;
    s.height = actualHeight;
    s._actualWidth = actualWidth;
    s._actualHeight = actualHeight;

    // VUI
    const vuiFlag = reader.readBits(1, 'vui_parameters_present_flag');
    s.vui_parameters_present_flag = vuiFlag;
    if (vuiFlag) s.vui_parameters = parseH264VuiParameters(reader);

    // Fallback field offsets
    const rbspByteLen = Math.ceil(reader.bitPosition / 8) - rbspStartByte;
    if (fieldOffsets && rbspByteLen > 0) {
      const fb = { offset: baseByteOffset + rbspStartByte, length: rbspByteLen };
      for (const key of Object.keys(s)) {
        if (key.startsWith('_')) continue;
        if (key === 'forbidden_zero_bit' || key === 'nal_ref_idc' || key === 'nal_unit_type') continue;
        if (key === 'profile_idc' || key === 'level_idc') continue;
        if (key.includes('constraint_set') || key === 'reserved_zero_2bits') continue;
        fieldOffsets[`${keyPrefix}.${key}`] ??= fb;
      }
    }

    s.rbsp_stop_one_bit = reader.readBits(1, 'rbsp_stop_one_bit');
    let alignIdx = 0;
    while (reader.bitPosition % 8 !== 0) {
      s[`rbsp_alignment_zero_bit[${alignIdx}]`] = reader.readBits(1);
      alignIdx++;
    }

    return s;
  } catch {
    return s; // 返回已解析的部分字段
  }
}

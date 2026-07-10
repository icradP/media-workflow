/**
 * H.265/HEVC VUI parameters parser.
 */

import { BitReader } from '../binary/reader.js';

const ASPECT_RATIO_IDC: Record<number, string> = {
  0: 'Unspecified', 1: '1:1 (Square)', 2: '12:11', 3: '10:11', 4: '16:11', 5: '40:33',
  6: '24:11', 7: '20:11', 8: '32:11', 9: '80:33', 10: '18:11', 11: '15:11',
  12: '64:33', 13: '160:99', 14: '4:3', 15: '3:2', 16: '2:1', 255: 'Extended_SAR',
};

const VUI_VIDEO_FORMAT: Record<number, string> = {
  0: 'Component', 1: 'PAL', 2: 'NTSC', 3: 'SECAM', 4: 'MAC', 5: 'Unspecified',
};

const VUI_COLOUR_PRIMARIES: Record<number, string> = {
  1: 'BT.709', 2: 'Unspecified', 4: 'BT.470M', 5: 'BT.470BG', 6: 'SMPTE 170M',
  7: 'SMPTE 240M', 8: 'FILM', 9: 'BT.2020', 10: 'SMPTE ST 428', 11: 'DCI-P3', 12: 'Display P3',
};

const VUI_TRANSFER: Record<number, string> = {
  1: 'BT.709', 4: 'BT.470M', 5: 'BT.470BG', 6: 'SMPTE 170M', 7: 'SMPTE 240M',
  8: 'Linear', 9: 'Log 100:1', 10: 'Log 316:1', 11: 'IEC 61966-2-4', 12: 'BT.1361',
  13: 'IEC 61966-2-1 (sRGB)', 14: 'BT.2020 10-bit', 15: 'BT.2020 12-bit',
  16: 'SMPTE ST 2084 (PQ)', 17: 'SMPTE ST 428', 18: 'ARIB STD-B67 (HLG)',
};

const VUI_MATRIX: Record<number, string> = {
  0: 'Identity', 1: 'BT.709', 4: 'FCC', 5: 'BT.470BG', 6: 'SMPTE 170M',
  7: 'SMPTE 240M', 8: 'YCgCo', 9: 'BT.2020 NCL', 10: 'BT.2020 CL',
  11: 'SMPTE ST 2085', 12: 'Chroma NCL', 13: 'Chroma CL', 14: 'ICtCp',
};

export function parseHevcSpsVuiParameters(reader: BitReader): Record<string, unknown> {
  const a = {} as Record<string, unknown>;
  const prevOuter = reader.prefix;
  reader.prefix = prevOuter ? `${prevOuter}.vui_parameters` : 'vui_parameters';

  const arFlag = reader.readBits(1, 'aspect_ratio_info_present_flag');
  a.aspect_ratio_info_present_flag = arFlag;
  if (arFlag) {
    const idc = reader.readBits(8, 'aspect_ratio_idc');
    a.aspect_ratio_idc = `${idc} (${ASPECT_RATIO_IDC[idc] ?? 'Reserved'})`;
    if (idc === 255) { a.sar_width = reader.readBits(16); a.sar_height = reader.readBits(16); }
  }

  const overscanFlag = reader.readBits(1, 'overscan_info_present_flag');
  a.overscan_info_present_flag = overscanFlag;
  if (overscanFlag) a.overscan_appropriate_flag = reader.readBits(1);

  const vsFlag = reader.readBits(1, 'video_signal_type_present_flag');
  a.video_signal_type_present_flag = vsFlag;
  if (vsFlag) {
    const vs = {} as Record<string, unknown>;
    const prev = reader.prefix; reader.prefix = `${prev}.video_signal_type`;
    const fmt = reader.readBits(3, 'video_format');
    vs.video_format = `${fmt} (${VUI_VIDEO_FORMAT[fmt] ?? 'Unknown'})`;
    vs.video_full_range_flag = reader.readBits(1, 'video_full_range_flag');
    const cdFlag = reader.readBits(1, 'colour_description_present_flag');
    vs.colour_description_present_flag = cdFlag;
    if (cdFlag) {
      const cd = {} as Record<string, unknown>;
      const prev2 = reader.prefix; reader.prefix = `${prev2}.colour_description`;
      const cp = reader.readBits(8, 'colour_primaries');
      cd.colour_primaries = `${cp} (${VUI_COLOUR_PRIMARIES[cp] ?? 'Unspecified'})`;
      const tc = reader.readBits(8, 'transfer_characteristics');
      cd.transfer_characteristics = `${tc} (${VUI_TRANSFER[tc] ?? 'Unspecified'})`;
      const mc = reader.readBits(8, 'matrix_coefficients');
      cd.matrix_coefficients = `${mc} (${VUI_MATRIX[mc] ?? 'Unknown'})`;
      reader.prefix = prev2; vs.colour_description = cd;
    }
    reader.prefix = prev; a.video_signal_type = vs;
  }

  const chromaFlag = reader.readBits(1, 'chroma_loc_info_present_flag');
  a.chroma_loc_info_present_flag = chromaFlag;
  if (chromaFlag) {
    a.chroma_sample_loc_type_top_field = reader.readUE();
    a.chroma_sample_loc_type_bottom_field = reader.readUE();
  }

  a.neutral_chroma_indication_flag = reader.readBits(1);
  a.field_seq_flag = reader.readBits(1);
  a.frame_field_info_present_flag = reader.readBits(1);

  const ddFlag = reader.readBits(1, 'default_display_window_flag');
  a.default_display_window_flag = ddFlag;
  if (ddFlag) {
    a.def_disp_win_left_offset = reader.readUE(); a.def_disp_win_right_offset = reader.readUE();
    a.def_disp_win_top_offset = reader.readUE(); a.def_disp_win_bottom_offset = reader.readUE();
  }

  const timingFlag = reader.readBits(1, 'vui_timing_info_present_flag');
  a.vui_timing_info_present_flag = timingFlag;
  if (timingFlag) {
    const ti = {} as Record<string, unknown>;
    const prev = reader.prefix; reader.prefix = `${prev}.timing_info`;
    const unitsInTick = reader.readBits(32, 'vui_num_units_in_tick') >>> 0;
    const timeScale = reader.readBits(32, 'vui_time_scale') >>> 0;
    ti.vui_num_units_in_tick = unitsInTick;
    ti.vui_time_scale = timeScale;
    if (unitsInTick > 0) ti.calculated_frame_rate = `${(timeScale / unitsInTick).toFixed(3)} fps`;
    const pocFlag = reader.readBits(1);
    ti.vui_poc_proportional_to_timing_flag = pocFlag;
    if (pocFlag) ti.vui_num_ticks_poc_diff_one_minus1 = reader.readUE();
    reader.prefix = prev; a.timing_info = ti;
  }

  const hrdFlag = reader.readBits(1, 'vui_hrd_parameters_present_flag');
  a.vui_hrd_parameters_present_flag = hrdFlag;
  if (hrdFlag) a._hrd_parameters_note = 'HRD present but not parsed';

  const brFlag = reader.readBits(1, 'bitstream_restriction_flag');
  a.bitstream_restriction_flag = brFlag;
  if (brFlag) {
    const br = {} as Record<string, unknown>;
    const prev = reader.prefix; reader.prefix = `${prev}.bitstream_restriction`;
    br.tiles_fixed_structure_flag = reader.readBits(1);
    br.motion_vectors_over_pic_boundaries_flag = reader.readBits(1);
    br.restricted_ref_pic_lists_flag = reader.readBits(1);
    br.min_spatial_segmentation_idc = reader.readUE();
    br.max_bytes_per_pic_denom = reader.readUE();
    br.max_bits_per_min_cu_denom = reader.readUE();
    br.log2_max_mv_length_horizontal = reader.readUE();
    br.log2_max_mv_length_vertical = reader.readUE();
    reader.prefix = prev; a.bitstream_restriction = br;
  }

  reader.prefix = prevOuter;
  return a;
}

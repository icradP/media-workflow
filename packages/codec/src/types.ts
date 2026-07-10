/**
 * Codec 解析结果类型 — 替换全部 Record<string, unknown>
 *
 * 规则:
 *  - xxxValue 后缀 = 原始数值（不带展示文本）
 *  - 无后缀 = 带展示文本的字符串（如 "100 (High)"）
 *  - 可选字段用 ? 标记
 *  - 嵌套子结构有独立 interface
 */

// ─── H.264 ───

export interface H264NalHeader {
  forbidden_zero_bit: number;
  nal_ref_idc: number;
  nal_unit_type: number;
}

export interface H264SpsResult {
  // NAL header
  forbidden_zero_bit: number;
  nal_ref_idc: number;
  nal_unit_type: number;
  // SPS fields
  profile_idc: string;
  profileIdcValue: number;
  constraint_set0_flag: number;
  constraint_set1_flag: number;
  constraint_set2_flag: number;
  constraint_set3_flag: number;
  constraint_set4_flag: number;
  constraint_set5_flag: number;
  reserved_zero_2bits: number;
  level_idc: string;
  levelIdcValue: number;
  seq_parameter_set_id: number;
  chroma_format_idc: string;
  chromaFormatIdcValue: number;
  separate_colour_plane_flag?: number;
  bit_depth_luma_minus8: string;
  bitDepthLumaValue: number;
  bit_depth_chroma_minus8: string;
  bitDepthChromaValue: number;
  qpprime_y_zero_transform_bypass_flag?: number;
  seq_scaling_matrix_present_flag?: number;
  log2_max_frame_num_minus4: number;
  pic_order_cnt_type: number;
  log2_max_pic_order_cnt_lsb_minus4?: number;
  delta_pic_order_always_zero_flag?: number;
  offset_for_non_ref_pic?: number;
  offset_for_top_to_bottom_field?: number;
  num_ref_frames_in_pic_order_cnt_cycle?: number;
  offset_for_ref_frame?: number[];
  max_num_ref_frames: number;
  gaps_in_frame_num_allowed_flag: number;
  pic_width_in_mbs_minus1: string;
  picHeightInMapUnitsMinus1: string;
  frame_mbs_only_flag: number;
  mb_adaptive_frame_field_flag?: number;
  direct_8x8_inference_flag: number;
  frame_cropping_flag: number;
  frame_crop_left_offset?: number;
  frame_crop_right_offset?: number;
  frame_crop_top_offset?: number;
  frame_crop_bottom_offset?: number;
  /** 实际像素宽度（裁剪后） */
  width: number;
  /** 实际像素高度（裁剪后） */
  height: number;
  vui_parameters_present_flag: number;
  vui_parameters?: H264VuiParams;
  rbsp_stop_one_bit?: number;
  // Legacy aliases (for migration compat)
  _actualWidth: number;
  _actualHeight: number;
  _profile_idc_value: number;
  _level_idc_value: number;
  _chroma_format_idc_value: number;
  _bit_depth_luma_value: number;
  _bit_depth_chroma_value: number;
  _pic_width_in_mbs_minus1_value: number;
  _pic_height_in_map_units_minus1_value: number;
  [key: string]: unknown; // Allow extra fields (old API compat)
}

// ─── HRD parameters (shared by H.264/H.265) ───

export interface HrdParams {
  cpb_cnt_minus1: number;
  bit_rate_scale: number;
  cpb_size_scale: number;
  cpb_specs: Array<{
    bit_rate_value_minus1: number;
    cpb_size_value_minus1: number;
    cbr_flag: number;
  }>;
  initial_cpb_removal_delay_length_minus1: number;
  cpb_removal_delay_length_minus1: number;
  dpb_output_delay_length_minus1: number;
  time_offset_length: number;
}

// ─── H.264 VUI ───

export interface H264VuiParams {
  aspect_ratio_info_present_flag: number;
  aspect_ratio_idc: string;
  sar_width?: number;
  sar_height?: number;
  overscan_info_present_flag: number;
  overscan_info?: { overscan_appropriate_flag: number };
  video_signal_type_present_flag: number;
  video_signal_type?: H264VideoSignalType;
  chroma_loc_info_present_flag: number;
  chroma_loc_info?: {
    chroma_sample_loc_type_top_field: number;
    chroma_sample_loc_type_bottom_field: number;
  };
  timing_info_present_flag: number;
  timing_info?: H264TimingInfo;
  nal_hrd_parameters_present_flag: number;
  nal_hrd_parameters?: HrdParams;
  vcl_hrd_parameters_present_flag: number;
  vcl_hrd_parameters?: HrdParams;
  low_delay_hrd_flag?: number;
  pic_struct_present_flag: number;
  bitstream_restriction_flag: number;
  bitstream_restriction?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface H264VideoSignalType {
  video_format: string;
  video_full_range_flag: number;
  colour_description_present_flag: number;
  colour_description?: {
    colour_primaries: string;
    transfer_characteristics: string;
    matrix_coefficients: string;
  };
}

export interface H264TimingInfo {
  num_units_in_tick: number;
  time_scale: number;
  fixed_frame_rate_flag: number;
  calculated_frame_rate?: string;
}

export interface H264SliceResult {
  first_mb_in_slice: number;
  slice_type: string;
  sliceTypeValue: number;
  pic_parameter_set_id: number;
  frame_num: number;
  field_pic_flag?: number;
  bottom_field_flag?: number;
  idr_pic_id?: number;
  pic_order_cnt_lsb?: number;
  delta_pic_order_cnt_bottom?: number;
  delta_pic_order_cnt_0?: number;
  delta_pic_order_cnt_1?: number;
  direct_spatial_mv_pred_flag?: number;
  num_ref_idx_active_override_flag?: number;
  num_ref_idx_l0_active_minus1?: number;
  num_ref_idx_l1_active_minus1?: number;
  slice_qp_delta: number;
  disable_deblocking_filter_idc?: number;
  slice_alpha_c0_offset_div2?: number;
  slice_beta_offset_div2?: number;
  cabac_init_idc?: number;
  [key: string]: unknown;
}

export interface H264SeiResult {
  forbidden_zero_bit: number;
  nal_ref_idc: number;
  nal_unit_type: number;
  [key: string]: unknown; // Dynamic SEI message fields
}

// ─── H.265 ───

export interface HevcNalHeader {
  forbidden_zero_bit: number;
  nal_unit_type: number;
  nal_unit_type_name: string;
  nuh_layer_id: number;
  nuh_temporal_id_plus1: number;
}

export interface HevcProfileTierLevel {
  general_profile_space: number;
  general_tier_flag: string;
  generalTierFlagValue: number;
  general_profile_idc: string;
  generalProfileIdcValue: number;
  general_profile_compatibility_flags: Record<string, number>;
  general_progressive_source_flag: number;
  general_interlaced_source_flag: number;
  general_non_packed_constraint_flag: number;
  general_frame_only_constraint_flag: number;
  general_level_idc: string;
  generalLevelIdcValue: number;
  [key: string]: unknown;
}

export interface HevcVpsResult {
  forbidden_zero_bit: number;
  nal_unit_type: string;
  nalUnitTypeValue: number;
  nuh_layer_id: number;
  nuh_temporal_id_plus1: number;
  vps_video_parameter_set_id: number;
  vps_max_sub_layers_minus1: number;
  vps_temporal_id_nesting_flag: number;
  profile_tier_level: HevcProfileTierLevel;
  vps_sub_layer_ordering_info_present_flag: number;
  vps_max_layer_id: number;
  vps_num_layer_sets_minus1: number;
  vps_timing_info_present_flag: number;
  vps_num_units_in_tick?: number;
  vps_time_scale?: number;
  vps_extension_flag: number;
  [key: string]: unknown;
}

export interface HevcSpsResult {
  forbidden_zero_bit: number;
  nal_unit_type: string;
  nalUnitTypeValue: number;
  nuh_layer_id: number;
  nuh_temporal_id_plus1: number;
  sps_video_parameter_set_id: number;
  sps_max_sub_layers_minus1: number;
  sps_temporal_id_nesting_flag: number;
  profile_tier_level: HevcProfileTierLevel;
  sps_seq_parameter_set_id: number;
  chroma_format_idc: string;
  chromaFormatIdcValue: number;
  separate_colour_plane_flag?: number;
  pic_width_in_luma_samples: string;
  pic_height_in_luma_samples: string;
  width: number;
  height: number;
  conformance_window_flag: number;
  bit_depth_luma_minus8: string;
  bitDepthLumaValue: number;
  bit_depth_chroma_minus8: string;
  bitDepthChromaValue: number;
  log2_max_pic_order_cnt_lsb_minus4: number;
  sps_sub_layer_ordering_info_present_flag: number;
  scaling_list_enabled_flag: number;
  amp_enabled_flag: number;
  sample_adaptive_offset_enabled_flag: number;
  pcm_enabled_flag: number;
  num_short_term_ref_pic_sets: number;
  long_term_ref_pics_present_flag: number;
  sps_temporal_mvp_enabled_flag: number;
  strong_intra_smoothing_enabled_flag: number;
  vui_parameters_present_flag: number;
  vui_parameters?: HevcVuiParams;
  sps_extension_present_flag: number;
  // Legacy aliases
  _actualWidth: number;
  _actualHeight: number;
  _chroma_format_idc_value: number;
  _bit_depth_luma_value: number;
  _bit_depth_chroma_value: number;
  _pic_width_in_luma_samples_value: number;
  _pic_height_in_luma_samples_value: number;
  _parseError?: string;
  [key: string]: unknown;
}

export interface HevcVuiParams {
  aspect_ratio_info_present_flag: number;
  overscan_info_present_flag: number;
  video_signal_type_present_flag: number;
  chroma_loc_info_present_flag: number;
  neutral_chroma_indication_flag: number;
  field_seq_flag: number;
  frame_field_info_present_flag: number;
  default_display_window_flag: number;
  vui_timing_info_present_flag: number;
  timing_info?: { vui_num_units_in_tick: number; vui_time_scale: number; calculated_frame_rate?: string };
  vui_hrd_parameters_present_flag: number;
  bitstream_restriction_flag: number;
  [key: string]: unknown;
}

export interface HevcPpsResult {
  forbidden_zero_bit: number;
  nal_unit_type: string;
  nuh_layer_id: number;
  nuh_temporal_id_plus1: number;
  pps_pic_parameter_set_id: number;
  pps_seq_parameter_set_id: number;
  dependent_slice_segments_enabled_flag: number;
  output_flag_present_flag: number;
  num_extra_slice_header_bits: number;
  cabac_init_present_flag: number;
  num_ref_idx_l0_default_active_minus1: number;
  num_ref_idx_l1_default_active_minus1: number;
  init_qp_minus26: number;
  constrained_intra_pred_flag: number;
  transform_skip_enabled_flag: number;
  weighted_pred_flag: number;
  weighted_bipred_flag: number;
  tiles_enabled_flag: number;
  entropy_coding_sync_enabled_flag: number;
  pps_loop_filter_across_slices_enabled_flag: number;
  deblocking_filter_control_present_flag: number;
  deblocking_filter_override_enabled_flag?: number;
  lists_modification_present_flag: number;
  slice_segment_header_extension_present_flag: number;
  [key: string]: unknown;
}

export interface HevcSliceResult {
  first_slice_segment_in_pic_flag: number;
  slice_pic_parameter_set_id: number;
  slice_type: string;
  sliceTypeValue: number;
  slice_pic_order_cnt_lsb?: number;
  num_ref_idx_l0_active_minus1?: number;
  num_ref_idx_l1_active_minus1?: number;
  slice_qp_delta: number;
  [key: string]: unknown;
}

// ─── AAC ───

export interface AacAscResult {
  audioObjectType: number;
  audioObjectTypeName: string;
  samplingFrequencyIndex: number;
  samplingFrequency: number;
  channelConfiguration: number;
  channels: number;
  channelLayout: string;
  frameLengthFlag: number;
  dependsOnCoreCoder: number;
  extensionFlag: number;
  extensionSamplingFrequencyIndex?: number;
  extensionSamplingFrequency?: number;
  extensionAudioObjectType?: number;
  extensionAudioObjectTypeName?: string;
  sbrPresentFlag?: number;
  psPresentFlag?: number;
  // Legacy aliases
  _samplingFrequency_value: number;
  _channelConfiguration_value: number;
  [key: string]: unknown;
}

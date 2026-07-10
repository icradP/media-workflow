/**
 * H.265/HEVC constants.
 */

export const HEVC_PROFILES: Record<number, string> = {
  0: 'No Profile', 1: 'Main', 2: 'Main 10', 3: 'Main Still Picture',
  4: 'Format Range Extensions', 5: 'High Throughput', 9: 'Screen Content Coding Extensions',
};

export const HEVC_NAL_TYPE_NAMES: Record<number, string> = {
  0: 'TRAIL_N', 1: 'TRAIL_R', 19: 'IDR_W_RADL', 20: 'IDR_N_LP', 21: 'CRA_NUT',
  32: 'VPS_NUT', 33: 'SPS_NUT', 34: 'PPS_NUT', 39: 'PREFIX_SEI_NUT', 40: 'SUFFIX_SEI_NUT',
};

export const HEVC_SEI_PAYLOAD_LABELS: Record<number, string> = {
  0: 'buffering_period', 1: 'pic_timing', 4: 'user_data_registered',
  5: 'user_data_unregistered', 6: 'recovery_point', 9: 'scene_info',
  19: 'film_grain_characteristics', 23: 'tone_mapping_info',
  45: 'frame_packing_arrangement', 47: 'display_orientation',
  129: 'display_orientation', 137: 'mastering_display_colour_volume',
  144: 'content_light_level_info', 147: 'alternative_transfer_characteristics',
};

export function hevcNalUnitTypeName(nalType: number): string {
  return HEVC_NAL_TYPE_NAMES[nalType] ?? 'UNKNOWN';
}

export function getHEVCProfileName(profileIdc: number): string {
  return HEVC_PROFILES[profileIdc] ?? `Unknown Profile (${profileIdc})`;
}

export function getHEVCLevelName(levelIdc: number): string {
  return `Level ${(levelIdc / 30).toFixed(1)}`;
}

export function getHEVCTierName(tier: number): string {
  return tier === 0 ? 'Main' : tier === 1 ? 'High' : `Unknown Tier (${tier})`;
}

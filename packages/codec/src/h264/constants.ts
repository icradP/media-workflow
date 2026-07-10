/**
 * H.264 / AVC constants and name lookup helpers.
 */

export const AVC_PROFILES: Record<number, string> = {
  44: 'CAVLC 4:4:4 Intra',
  66: 'Baseline',
  77: 'Main',
  83: 'Scalable Baseline',
  86: 'Scalable High',
  88: 'Extended',
  100: 'High',
  110: 'High 10',
  122: 'High 4:2:2',
  244: 'High 4:4:4 Predictive',
  118: 'Multiview High',
  128: 'Stereo High',
  134: 'MFC High',
  135: 'MFC Depth High',
  138: 'Multiview Depth High',
  139: 'Enhanced Multiview Depth High',
};

export const SLICE_TYPES: Record<number, string> = {
  0: 'P slice (Predicted)',
  1: 'B slice (Bi-directional predicted)',
  2: 'I slice (Intra)',
  3: 'SP slice',
  4: 'SI slice',
  5: 'P slice (all slices in picture are P)',
  6: 'B slice (all slices in picture are B)',
  7: 'I slice (all slices in picture are I)',
  8: 'SP slice (all slices in picture are SP)',
  9: 'SI slice (all slices in picture are SI)',
};

export function getAVCProfileName(profileIdc: number): string {
  return AVC_PROFILES[profileIdc] ?? `Unknown Profile (${profileIdc})`;
}

export function getAVCLevelName(levelIdc: number): string {
  return `Level ${(levelIdc / 10).toFixed(1)}`;
}

export function getChromaFormatName(chromaFormatIdc: number): string {
  const map: Record<number, string> = {
    0: 'Monochrome',
    1: '4:2:0',
    2: '4:2:2',
    3: '4:4:4',
  };
  return map[chromaFormatIdc] ?? 'Unknown';
}

export function getSliceTypeName(sliceType: number): string {
  return SLICE_TYPES[sliceType] ?? `Unknown (${sliceType})`;
}

/** High profile IDs that include chroma_format_idc, bit_depth etc. */
export const HIGH_PROFILE_IDS: number[] = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134];

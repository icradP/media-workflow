/**
 * Slice type / Picture type mapping utilities.
 *
 * Maps H.264 and H.265 slice_type values to picture type labels (I/P/B).
 */

export type PictureType = 'I' | 'P' | 'B';
export type CodecFamily = 'h264' | 'h265';

/**
 * Map H.264/H.265 slice_type to picture type label.
 *
 * H.264 slice_type (0-9): 0=P, 1=B, 2=I, 3=SP, 4=SI, 5-9=all variants
 *   Using mod 5: SP(3)→P, SI(4)→I
 *
 * H.265 slice_type (0-2): 0=B, 1=P, 2=I
 */
export function pictureTypeFromSliceType(
  sliceType: number | null | undefined,
  codecFamily: CodecFamily,
): PictureType | null {
  if (sliceType == null) return null;
  const v = Number(sliceType);

  if (codecFamily === 'h264') {
    const n = v % 5;
    if (n === 2 || n === 4) return 'I'; // I, SI
    if (n === 0 || n === 3) return 'P'; // P, SP
    if (n === 1) return 'B';
  } else {
    if (v === 2) return 'I';
    if (v === 1) return 'P';
    if (v === 0) return 'B';
  }

  return null;
}

/**
 * Extract picture type from parsed NAL units with slice info.
 */
export function pictureTypeFromNalus(
  nalus: Array<{ _slice_type_value?: number; type?: string }> | null | undefined,
): PictureType | null {
  if (!nalus || nalus.length === 0) return null;
  for (const n of nalus) {
    const v = n?._slice_type_value;
    if (v == null) continue;
    const pt = pictureTypeFromSliceType(v, (n.type as CodecFamily) ?? 'h264');
    if (pt) return pt;
  }
  return null;
}

/**
 * Map NAL unit type to picture type (I/P only — cannot detect B-frames without
 * parsing the full slice header).
 *
 * H.264 NAL types: 5=IDR→I, 1-4=non-IDR slice→P
 * H.265 NAL types: 16-21=IDR/CRA/BLA→I, 0-9=non-IRAP slice→P
 */
export function pictureTypeFromNalType(
  nalType: number | null | undefined,
  codecFamily: CodecFamily,
): 'I' | 'P' | null {
  if (nalType == null) return null;
  const v = Number(nalType);

  if (codecFamily === 'h264') {
    if (v === 5) return 'I';
    if (v >= 1 && v <= 4) return 'P';
  } else {
    if (v >= 16 && v <= 21) return 'I';
    if (v >= 0 && v <= 9) return 'P';
  }

  return null;
}

/**
 * Map keyframe flag to picture type.
 */
export function pictureTypeFromKeyframeFlag(isKeyframe: boolean | null | undefined): 'I' | 'P' {
  return isKeyframe ? 'I' : 'P';
}

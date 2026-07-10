/**
 * NAL unit processing utilities.
 */

import { removeEmulationPrevention } from './annexb.js';

/**
 * Prepare RBSP from a NAL unit by removing emulation prevention bytes (EPB)
 * and combining the header with the cleaned RBSP.
 *
 * Common pattern shared by H.264 and H.265 slice parsers:
 * 1. Slice out NAL header (headerLen bytes)
 * 2. Remove EPB from remaining bytes
 * 3. Combine header + RBSP into single buffer
 * 4. Adjust removedPositions offsets by headerLen
 */
export function prepareRbspWithHeader(
  nalu: Uint8Array,
  headerLen: number,
): { combined: Uint8Array; removedPositions: number[]; headerBytes: Uint8Array } {
  const headerBytes = nalu.slice(0, headerLen);
  const epb = removeEmulationPrevention(nalu.slice(headerLen));
  const rbsp = epb.data;
  const removedPositions = epb.removedPositions.map(k => k + headerLen);
  const combined = new Uint8Array(headerBytes.length + rbsp.length);
  combined.set(headerBytes, 0);
  combined.set(rbsp, headerBytes.length);
  return { combined, removedPositions, headerBytes };
}

/** NAL unit type constants for H.264 */
export const H264_NAL_UNSPECIFIED = 0;
export const H264_NAL_NON_IDR_SLICE = 1;
export const H264_NAL_IDR_SLICE = 5;
export const H264_NAL_SEI = 6;
export const H264_NAL_SPS = 7;
export const H264_NAL_PPS = 8;
export const H264_NAL_AUD = 9;
export const H264_NAL_FILLER = 12;

/** NAL unit type constants for H.265 */
export const H265_NAL_VPS = 32;
export const H265_NAL_SPS = 33;
export const H265_NAL_PPS = 34;
export const H265_NAL_IDR_W_RADL = 19;
export const H265_NAL_IDR_N_LP = 20;
export const H265_NAL_CRA = 21;
export const H265_NAL_PREFIX_SEI = 39;
export const H265_NAL_SUFFIX_SEI = 40;

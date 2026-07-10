/**
 * NAL unit Annex-B utilities.
 *
 * Annex-B format uses start codes (00 00 01 or 00 00 00 01) to delimit NAL units.
 * AVCC format uses length-prefixed NAL units.
 */

export interface StartCode {
  offset: number;
  /** 3 or 4 bytes */
  length: number;
}

/**
 * Find the next Annex-B start code in a byte array.
 *
 * @returns Start code position and length, or null if not found.
 */
export function findAnnexBStartCode(data: Uint8Array, from = 0): StartCode | null {
  for (let i = Math.max(0, from); i + 3 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0) {
      if (data[i + 2] === 1) return { offset: i, length: 3 };
      if (i + 3 < data.length && data[i + 2] === 0 && data[i + 3] === 1) return { offset: i, length: 4 };
    }
  }
  return null;
}

/**
 * Check if a byte array STARTS with an Annex-B start code.
 *
 * Only checks the beginning — AVCC slice data may contain 00 00 01
 * inside coded data and must not be mis-classified.
 */
export function hasAnnexBStartCode(data: Uint8Array): boolean {
  if (data.length < 3) return false;
  if (data[0] === 0 && data[1] === 0 && data[2] === 1) return true;
  if (data.length >= 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) return true;
  return false;
}

/**
 * Find the next Annex-B start code and return offset to the payload (after the start code).
 *
 * @returns Payload offset, or -1 if not found.
 */
export function findAnnexBStartCodeOffset(data: Uint8Array, from = 0): number {
  const sc = findAnnexBStartCode(data, from);
  return sc ? sc.offset + sc.length : -1;
}

/**
 * Split an Annex-B byte stream into individual NAL units (without start codes).
 *
 * Strips trailing zero bytes that belong to the next start code prefix.
 */
export function splitAnnexBNalus(data: Uint8Array): Uint8Array[] {
  const first = findAnnexBStartCode(data, 0);
  if (!first) return [];
  const nalus: Uint8Array[] = [];
  let start = first.offset + first.length;
  while (start < data.length) {
    const next = findAnnexBStartCode(data, start);
    let end = next ? next.offset : data.length;
    // Strip trailing zeros (they belong to the next start code prefix)
    while (end > start && data[end - 1] === 0) end -= 1;
    if (end > start) nalus.push(data.subarray(start, end));
    if (!next) break;
    start = next.offset + next.length;
  }
  return nalus;
}

/**
 * Convert Annex-B byte stream to length-prefixed (AVCC) format.
 * Each NAL unit is prefixed with a 4-byte big-endian length.
 *
 * @returns Length-prefixed data, or null if no NALUs found.
 */
export function annexBToLengthPrefixed(data: Uint8Array): Uint8Array | null {
  const nalus = splitAnnexBNalus(data);
  if (!nalus.length) return null;
  const total = nalus.reduce((n, nalu) => n + 4 + nalu.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const nalu of nalus) {
    const len = nalu.length >>> 0;
    out[off] = (len >>> 24) & 0xff;
    out[off + 1] = (len >>> 16) & 0xff;
    out[off + 2] = (len >>> 8) & 0xff;
    out[off + 3] = len & 0xff;
    out.set(nalu, off + 4);
    off += 4 + nalu.length;
  }
  return out;
}

/**
 * Split a length-prefixed (AVCC) byte stream into individual NAL units.
 *
 * @param lengthSize — Number of bytes for the length field (1-4).
 * @returns Array of NAL units, or null if invalid.
 */
export function splitLengthPrefixedNalUnits(
  bytes: Uint8Array,
  lengthSize: number,
): Uint8Array[] | null {
  if (lengthSize < 1 || lengthSize > 4) return null;
  const out: Uint8Array[] = [];
  let off = 0;
  while (off + lengthSize <= bytes.length) {
    let len = 0;
    for (let i = 0; i < lengthSize; i++) len = (len * 256) + bytes[off + i]!;
    off += lengthSize;
    if (len <= 0 || off + len > bytes.length) return null;
    out.push(bytes.subarray(off, off + len));
    off += len;
  }
  return off === bytes.length && out.length ? out : null;
}

/**
 * Remove emulation prevention bytes (0x03 after 0x00 0x00).
 *
 * H.264/H.265 use emulation prevention to avoid false start codes.
 * Every 0x00 0x00 0x03 sequence (where 0x03 <= 3) is replaced with 0x00 0x00.
 *
 * @returns RBSP data and the list of removed byte positions.
 */
export function removeEmulationPrevention(
  data: Uint8Array,
): { data: Uint8Array; removedPositions: number[] } {
  const out: number[] = [];
  const removedPositions: number[] = [];
  let i = 0;
  while (i < data.length) {
    if (
      i + 2 < data.length &&
      data[i] === 0 &&
      data[i + 1] === 0 &&
      data[i + 2] === 3 &&
      i + 3 < data.length &&
      data[i + 3]! <= 3
    ) {
      out.push(0, 0);
      removedPositions.push(i + 2);
      i += 3;
      continue;
    }
    out.push(data[i]!);
    i++;
  }
  return {
    data: new Uint8Array(out),
    removedPositions,
  };
}

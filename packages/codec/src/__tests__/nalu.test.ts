import { describe, it, expect } from 'vitest';
import { findAnnexBStartCode, hasAnnexBStartCode, splitAnnexBNalus, annexBToLengthPrefixed, splitLengthPrefixedNalUnits, removeEmulationPrevention } from '../nalu/annexb';

describe('findAnnexBStartCode', () => {
  it('finds 3-byte start code', () => {
    const data = new Uint8Array([0x00, 0x00, 0x01, 0x09, 0x10]);
    const sc = findAnnexBStartCode(data, 0);
    expect(sc).toEqual({ offset: 0, length: 3 });
  });

  it('finds 4-byte start code', () => {
    const data = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x09]);
    const sc = findAnnexBStartCode(data, 0);
    expect(sc).toEqual({ offset: 0, length: 4 });
  });

  it('returns null if not found', () => {
    expect(findAnnexBStartCode(new Uint8Array([0x01, 0x02, 0x03]), 0)).toBeNull();
  });
});

describe('hasAnnexBStartCode', () => {
  it('returns true for Annex-B data', () => {
    expect(hasAnnexBStartCode(new Uint8Array([0x00, 0x00, 0x01, 0x09]))).toBe(true);
    expect(hasAnnexBStartCode(new Uint8Array([0x00, 0x00, 0x00, 0x01]))).toBe(true);
  });

  it('returns false for non-Annex-B', () => {
    expect(hasAnnexBStartCode(new Uint8Array([0x01, 0x02, 0x03]))).toBe(false);
    expect(hasAnnexBStartCode(new Uint8Array([]))).toBe(false);
  });
});

describe('splitAnnexBNalus', () => {
  it('splits into NAL units', () => {
    // Two NAL units: SPS + PPS
    const data = new Uint8Array([
      0x00, 0x00, 0x01, 0x67, 0x42, 0x00,  // SPS
      0x00, 0x00, 0x01, 0x68, 0xce,         // PPS
    ]);
    const nalus = splitAnnexBNalus(data);
    expect(nalus).toHaveLength(2);
    expect(nalus[0]).toEqual(new Uint8Array([0x67, 0x42])); // trailing zero stripped (belongs to next start code prefix)
    expect(nalus[1]).toEqual(new Uint8Array([0x68, 0xce]));
  });

  it('returns empty for no start codes', () => {
    expect(splitAnnexBNalus(new Uint8Array([0x01, 0x02]))).toEqual([]);
  });
});

describe('annexBToLengthPrefixed', () => {
  it('converts to AVCC format', () => {
    const annexB = new Uint8Array([0x00, 0x00, 0x01, 0x67, 0x42]);
    const avcc = annexBToLengthPrefixed(annexB);
    expect(avcc).not.toBeNull();
    // 4-byte length prefix + 2 NAL bytes
    expect(avcc!.length).toBe(6);
    expect(avcc![0]).toBe(0); // length MSB
    expect(avcc![3]).toBe(2); // length = 2
  });
});

describe('splitLengthPrefixedNalUnits', () => {
  it('splits 4-byte length-prefixed data', () => {
    const data = new Uint8Array([
      0x00, 0x00, 0x00, 0x02, 0x67, 0x42,  // 2-byte NAL
      0x00, 0x00, 0x00, 0x02, 0x68, 0xce,  // 2-byte NAL
    ]);
    const nalus = splitLengthPrefixedNalUnits(data, 4);
    expect(nalus).toHaveLength(2);
  });
});

describe('removeEmulationPrevention', () => {
  it('removes 0x03 after 0x00 0x00', () => {
    const data = new Uint8Array([0x00, 0x00, 0x03, 0x00, 0x01]);
    const result = removeEmulationPrevention(data);
    expect(result.data).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x01]));
    expect(result.removedPositions).toEqual([2]);
  });

  it('returns unchanged data if no EPB', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03]);
    const result = removeEmulationPrevention(data);
    expect(result.data).toEqual(data);
    expect(result.removedPositions).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { toHex, toBinary, readUIntBE, bytesEqual } from '../binary/hex';
import { concatBytes, asciiBytes, writeU32, writeU16, writeU8, clamp, finiteNumber, positiveInt } from '../binary/utils';

describe('hex utils', () => {
  it('toHex converts to hex string', () => {
    expect(toHex(new Uint8Array([0x00, 0xff, 0xab]))).toBe('00 ff ab');
  });

  it('toBinary converts byte to binary', () => {
    expect(toBinary(0x0f)).toBe('00001111');
    expect(toBinary(0xff)).toBe('11111111');
  });

  it('readUIntBE reads big-endian', () => {
    expect(readUIntBE(new Uint8Array([0x01, 0x02]))).toBe(258);
  });

  it('bytesEqual compares correctly', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
  });
});

describe('binary utils', () => {
  it('concatBytes concatenates', () => {
    const result = concatBytes(new Uint8Array([1]), new Uint8Array([2, 3]));
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('asciiBytes converts to bytes', () => {
    expect(asciiBytes('AB')).toEqual(new Uint8Array([65, 66]));
  });

  it('writeU32 produces big-endian', () => {
    const bytes = writeU32(0x01020304);
    expect(bytes[0]).toBe(1);
    expect(bytes[1]).toBe(2);
    expect(bytes[2]).toBe(3);
    expect(bytes[3]).toBe(4);
  });

  it('writeU16 produces 2 bytes', () => {
    expect(writeU16(0x0102)).toEqual(new Uint8Array([1, 2]));
  });

  it('writeU8 produces 1 byte', () => {
    expect(writeU8(255)).toEqual(new Uint8Array([255]));
  });

  it('clamp works', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(20, 0, 10)).toBe(10);
  });

  it('finiteNumber handles NaN/Infinity', () => {
    expect(finiteNumber(NaN)).toBe(0);
    expect(finiteNumber(Infinity)).toBe(0);
    expect(finiteNumber(42)).toBe(42);
  });

  it('positiveInt handles non-positive', () => {
    expect(positiveInt(0)).toBe(1);
    expect(positiveInt(-5)).toBe(1);
    expect(positiveInt(NaN)).toBe(1);
    expect(positiveInt(3.7)).toBe(4);
  });
});

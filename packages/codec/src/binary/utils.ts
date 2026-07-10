/**
 * 二进制写出工具 — 用于构建 MP4 box、FLV tag 等
 */

/** 拼接多个 Uint8Array */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.byteLength;
  }
  return result;
}

/** ASCII 字符串 → Uint8Array */
export function asciiBytes(s: string): Uint8Array {
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    arr[i] = s.charCodeAt(i) & 0xff;
  }
  return arr;
}

/** 大端 u32 → 4 字节 */
export function writeU32(value: number): Uint8Array {
  const arr = new Uint8Array(4);
  new DataView(arr.buffer).setUint32(0, value, false);
  return arr;
}

/** 大端 u16 → 2 字节 */
export function writeU16(value: number): Uint8Array {
  const arr = new Uint8Array(2);
  new DataView(arr.buffer).setUint16(0, value, false);
  return arr;
}

/** 大端 u8 → 1 字节 */
export function writeU8(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

/** 大端 u24 → 3 字节 */
export function writeU24(value: number): Uint8Array {
  const arr = new Uint8Array(3);
  arr[0] = (value >> 16) & 0xff;
  arr[1] = (value >> 8) & 0xff;
  arr[2] = value & 0xff;
  return arr;
}

/** 大端 u64 → 8 字节 */
export function writeU64(value: bigint): Uint8Array {
  const arr = new Uint8Array(8);
  new DataView(arr.buffer).setBigUint64(0, value, false);
  return arr;
}

/** 大端 i32 → 4 字节 */
export function writeI32(value: number): Uint8Array {
  const arr = new Uint8Array(4);
  new DataView(arr.buffer).setInt32(0, value, false);
  return arr;
}

/** 有限数字转整数（NaN/Infinity → 0） */
export function finiteNumber(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/** 钳位到 [min, max] */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 正整数（NaN/Infinity/≤0 → 1） */
export function positiveInt(v: number): number {
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 1;
}

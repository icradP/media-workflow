/**
 * 进制转换工具 — 十六进制、二进制表示
 */

/** Uint8Array → 十六进制字符串（空格分隔） */
export function toHex(bytes: Uint8Array, separator = ' '): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(separator);
}

/** 单字节 → 二进制字符串 */
export function toBinary(byte: number): string {
  return byte.toString(2).padStart(8, '0');
}

/** 大端多字节序列 → 整数 */
export function readUIntBE(bytes: Uint8Array, offset = 0, length = bytes.length): number {
  let value = 0;
  for (let i = 0; i < length; i++) {
    value = (value << 8) | (bytes[offset + i] ?? 0);
  }
  return value;
}

/** 比较两个 Uint8Array 是否相等 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

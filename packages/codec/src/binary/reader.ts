/**
 * 二进制读取器 — 带位置追踪的 bit/byte 读取器
 *
 * 从旧项目 lib/core/Be.js 重构而来，增加了：
 * - TypeScript 类型安全
 * - 越界检查
 * - Async 预留（文件切片读取）
 */

export interface FieldOffsetEntry {
  offset: number;
  length: number;
}

export class BitReader {
  readonly data: Uint8Array;
  readonly view: DataView;
  /** 当前字节位置 */
  pos: number;
  /** 当前 bit 偏移 (0-7, MSB first) */
  bitOff: number;
  /** 可选：field offset 记录 map */
  fieldOffsets?: Record<string, FieldOffsetEntry>;
  /** 可选：字段名前缀 */
  prefix: string;
  /** 可选：emulation prevention 移除位置（用于 offset 校正） */
  removedPositions?: number[];
  /** 基础字节偏移 */
  readonly baseByteOffset: number;

  constructor(
    data: Uint8Array,
    offset = 0,
    baseByteOffset = 0,
    fieldOffsets?: Record<string, FieldOffsetEntry>,
    prefix = '',
    removedPositions?: number[],
  ) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = offset;
    this.bitOff = 0;
    this.baseByteOffset = baseByteOffset;
    this.fieldOffsets = fieldOffsets;
    this.prefix = prefix;
    this.removedPositions = removedPositions;
  }

  /** 当前 bit 位置（从 0 开始） */
  get bitPosition(): number {
    return this.pos * 8 + this.bitOff;
  }

  get byteLength(): number {
    return this.data.byteLength;
  }

  get remaining(): number {
    return this.data.byteLength - this.pos;
  }

  // ─── Byte 读取 ───

  u8(): number {
    this.#checkBounds(1);
    return this.view.getUint8(this.pos++);
  }

  s8(): number {
    this.#checkBounds(1);
    return this.view.getInt8(this.pos++);
  }

  u16(littleEndian = false): number {
    this.#checkBounds(2);
    const v = this.view.getUint16(this.pos, littleEndian);
    this.pos += 2;
    return v;
  }

  u24(littleEndian = false): number {
    this.#checkBounds(3);
    const v = littleEndian
      ? this.view.getUint8(this.pos) | (this.view.getUint8(this.pos + 1) << 8) | (this.view.getUint8(this.pos + 2) << 16)
      : (this.view.getUint8(this.pos) << 16) | (this.view.getUint8(this.pos + 1) << 8) | this.view.getUint8(this.pos + 2);
    this.pos += 3;
    return v;
  }

  u32(littleEndian = false): number {
    this.#checkBounds(4);
    const v = this.view.getUint32(this.pos, littleEndian);
    this.pos += 4;
    return v;
  }

  i32(littleEndian = false): number {
    this.#checkBounds(4);
    const v = this.view.getInt32(this.pos, littleEndian);
    this.pos += 4;
    return v;
  }

  u64(littleEndian = false): bigint {
    this.#checkBounds(8);
    const v = this.view.getBigUint64(this.pos, littleEndian);
    this.pos += 8;
    return v;
  }

  f32(littleEndian = false): number {
    this.#checkBounds(4);
    const v = this.view.getFloat32(this.pos, littleEndian);
    this.pos += 4;
    return v;
  }

  f64(littleEndian = false): number {
    this.#checkBounds(8);
    const v = this.view.getFloat64(this.pos, littleEndian);
    this.pos += 8;
    return v;
  }

  /** 读取 n 字节 */
  bytes(n: number): Uint8Array {
    this.#checkBounds(n);
    const slice = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  /** 读取 null-terminated 字符串 */
  cstring(): string {
    const start = this.pos;
    while (this.pos < this.data.byteLength && this.data[this.pos] !== 0) {
      this.pos++;
    }
    const str = new TextDecoder().decode(this.data.slice(start, this.pos));
    this.pos++; // skip null
    return str;
  }

  /** 读取指定长度的 UTF-8 字符串 */
  string(length: number): string {
    this.#checkBounds(length);
    const str = new TextDecoder().decode(this.data.slice(this.pos, this.pos + length));
    this.pos += length;
    return str;
  }

  /** 跳过 n 字节 */
  skip(n: number): void {
    this.#checkBounds(n);
    this.pos += n;
  }

  /** 回退 n 字节 */
  rewind(n: number): void {
    this.pos = Math.max(0, this.pos - n);
  }

  /** 创建子读取器（引用同一块 buffer，不同 offset） */
  subReader(offset: number, length: number): BitReader {
    return new BitReader(this.data.slice(offset, offset + length));
  }

  /** 当前 offset 开始切片到末尾 */
  sliceFrom(offset: number): Uint8Array {
    return this.data.slice(offset);
  }

  // ─── Bit 读取 ───

  /**
   * 读取 n bits（对齐到字节边界后开始读）。
   * bitOff = 0 时从当前字节的 MSB 开始。
   */
  readBits(n: number, fieldName?: string): number {
    const bitStart = this.bitPosition;
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (this.bitOff === 0) {
        this.#checkBounds(1);
      }
      const byte = this.data[this.pos]!;
      const bit = (byte >> (7 - this.bitOff)) & 1;
      result = (result << 1) | bit;
      this.bitOff++;
      if (this.bitOff === 8) {
        this.bitOff = 0;
        this.pos++;
      }
    }
    this.#recordField(fieldName, bitStart, n);
    return result;
  }

  /** 读取 Exp-Golomb coded number (UE) */
  readUE(fieldName?: string): number {
    const bitStart = this.bitPosition;
    let leadingZeroBits = 0;
    while (this.readBits(1) === 0) {
      leadingZeroBits++;
    }
    if (leadingZeroBits === 0) return 0;
    const val = (1 << leadingZeroBits) - 1 + this.readBits(leadingZeroBits);
    this.#recordField(fieldName, bitStart, this.bitPosition - bitStart);
    return val;
  }

  /** 读取 Signed Exp-Golomb coded number (SE) */
  readSE(fieldName?: string): number {
    const bitStart = this.bitPosition;
    const ue = this.readUE();
    const val = ue % 2 === 0 ? -(ue / 2) : (ue + 1) / 2;
    this.#recordField(fieldName, bitStart, this.bitPosition - bitStart);
    return val;
  }

  /** 读取 n bits，不记录 field offset（SEI 批量读取用） */
  readBitsRaw(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (this.bitOff === 0) this.#checkBounds(1);
      const byte = this.data[this.pos]!;
      const bit = (byte >> (7 - this.bitOff)) & 1;
      result = (result << 1) | bit;
      this.bitOff++;
      if (this.bitOff === 8) { this.bitOff = 0; this.pos++; }
    }
    return result;
  }

  /** 读取 n 字节 UTF-8 字符串，可选 field offset 记录 */
  readString(n: number, fieldName?: string): string {
    const byteStart = this.pos;
    this.#checkBounds(n);
    const str = new TextDecoder().decode(this.data.slice(this.pos, this.pos + n));
    this.pos += n;
    if (fieldName && this.fieldOffsets) {
      const key = this.prefix ? `${this.prefix}.${fieldName}` : fieldName;
      let off = this.baseByteOffset + byteStart;
      if (this.removedPositions) {
        for (const rp of this.removedPositions) { if (rp < off) off++; }
      }
      this.fieldOffsets[key] = { offset: off, length: n };
    }
    return str;
  }

  /** 手动标记 field byte 起始 */
  private _fieldStartByte = -1;
  startField(_fieldName: string): void { this._fieldStartByte = this.pos; }
  finishField(fieldName: string): void {
    if (!this.fieldOffsets || this._fieldStartByte < 0) return;
    const key = this.prefix ? `${this.prefix}.${fieldName}` : fieldName;
    const len = this.pos - this._fieldStartByte;
    let off = this.baseByteOffset + this._fieldStartByte;
    if (this.removedPositions) {
      for (const rp of this.removedPositions) { if (rp < off) off++; }
    }
    this.fieldOffsets[key] = { offset: off, length: len };
    this._fieldStartByte = -1;
  }

  #recordField(fieldName: string | undefined, bitStart: number, bitLen: number): void {
    if (!fieldName || !this.fieldOffsets) return;
    const key = this.prefix ? `${this.prefix}.${fieldName}` : fieldName;
    // 计算绝对字节偏移（含 emulation prevention 校正）
    let byteOff = this.baseByteOffset + Math.floor(bitStart / 8);
    let byteLen = Math.ceil((bitStart + bitLen) / 8) - Math.floor(bitStart / 8);
    if (this.removedPositions) {
      for (const rp of this.removedPositions) {
        if (rp < byteOff) byteOff++;
      }
    }
    this.fieldOffsets[key] = { offset: byteOff, length: byteLen };
  }

  /** 对齐到下一个字节边界 */
  alignToByte(): void {
    if (this.bitOff > 0) {
      this.bitOff = 0;
      this.pos++;
    }
  }

  // ─── 工具 ───

  /** 查看下 n 字节但不推进位置 */
  peek(n: number): Uint8Array {
    return this.data.slice(this.pos, Math.min(this.pos + n, this.data.byteLength));
  }

  /** 在当前位置创建一个 marker，可以调用 marker.reset() 回退 */
  mark(): ReadMarker {
    return new ReadMarker(this);
  }

  #checkBounds(n: number): void {
    if (this.pos + n > this.data.byteLength) {
      throw new RangeError(
        `BitReader: read ${n} bytes at offset ${this.pos} exceeds buffer length ${this.data.byteLength}`,
      );
    }
  }
}

export class ReadMarker {
  private reader: BitReader;
  private savedPos: number;
  private savedBitOff: number;

  constructor(reader: BitReader) {
    this.reader = reader;
    this.savedPos = reader.pos;
    this.savedBitOff = reader.bitOff;
  }

  reset(): void {
    this.reader.pos = this.savedPos;
    this.reader.bitOff = this.savedBitOff;
  }
}

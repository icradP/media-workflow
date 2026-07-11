import type { BitstreamFormat } from '@media-workflow/core';

const START_CODE_3 = new Uint8Array([0, 0, 1]);
const START_CODE_4 = new Uint8Array([0, 0, 0, 1]);

export function avccToAnnexB(data: Uint8Array, lengthSize = 4): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset + lengthSize <= data.byteLength) {
    let naluLength = 0;
    for (let index = 0; index < lengthSize; index++) {
      naluLength = (naluLength << 8) | data[offset + index]!;
    }
    offset += lengthSize;
    if (naluLength <= 0 || offset + naluLength > data.byteLength) break;
    chunks.push(START_CODE_4, data.subarray(offset, offset + naluLength));
    offset += naluLength;
  }
  if (chunks.length === 0) return data;
  return concatenate(chunks);
}

export function annexBToAvcc(data: Uint8Array, lengthSize = 4): Uint8Array {
  const nalus = splitAnnexBNalus(data);
  if (nalus.length === 0) return data;
  const chunks: Uint8Array[] = [];
  for (const nalu of nalus) {
    const prefix = new Uint8Array(lengthSize);
    let length = nalu.byteLength;
    for (let index = lengthSize - 1; index >= 0; index--) {
      prefix[index] = length & 0xff;
      length >>= 8;
    }
    chunks.push(prefix, nalu);
  }
  return concatenate(chunks);
}

export function adaptPacketForDecoder(
  data: Uint8Array,
  bitstreamFormat: BitstreamFormat,
  targetFormat: BitstreamFormat,
): Uint8Array {
  if (bitstreamFormat === targetFormat) return data;
  if (bitstreamFormat === 'avcc' && targetFormat === 'annexb') {
    return avccToAnnexB(data);
  }
  if (bitstreamFormat === 'annexb' && targetFormat === 'avcc') {
    return annexBToAvcc(data);
  }
  return data;
}

export function splitAnnexBNalus(data: Uint8Array): Uint8Array[] {
  const nalus: Uint8Array[] = [];
  let index = 0;
  while (index < data.byteLength) {
    const start = findStartCode(data, index);
    if (start < 0) break;
    const startCodeLength = data[start + 2] === 0x01 ? 3 : 4;
    const next = findStartCode(data, start + startCodeLength);
    const end = next < 0 ? data.byteLength : next;
    const nalu = data.subarray(start + startCodeLength, end);
    if (nalu.byteLength > 0) nalus.push(nalu);
    index = end;
  }
  return nalus;
}

function findStartCode(data: Uint8Array, from: number): number {
  for (let index = from; index + 2 < data.byteLength; index++) {
    if (data[index] === 0 && data[index + 1] === 0) {
      if (data[index + 2] === 1) return index;
      if (index + 3 < data.byteLength && data[index + 2] === 0 && data[index + 3] === 1) {
        return index;
      }
    }
  }
  return -1;
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

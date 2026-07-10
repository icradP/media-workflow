/**
 * FLV Tag 解析 — 合并 tag header + video body (AVC/HEVC) + audio body (AAC) + AMF0 metadata
 *
 * 从旧 lib/codec/flvTagParse.js + flvVideoTagBody.js + flvAudioTag.js + flvAmf.js 重构
 */

import { BitReader } from '../binary/reader.js';
import type { H264SpsResult } from '../types.js';
import { parseH264SpsNaluPayload } from '../h264/sps.js';
import { parseAudioSpecificConfig } from '../aac/asc.js';
import { pictureTypeFromSliceType } from '../nalu/picture.js';
import { splitAnnexBNalus, findAnnexBStartCode } from '../nalu/annexb.js';
import { parseHevcSpsNaluPayload } from '../h265/sps.js';

// ─── Labels ───

function flvVideoCodecIdName(id: number): string {
  const m: Record<number, string> = {
    2: 'Sorenson H.263', 3: 'Screen video', 4: 'On2 VP6',
    5: 'On2 VP6 with alpha', 6: 'Screen video v2', 7: 'AVC (H.264)',
    12: 'HEVC (H.265)', 13: 'AV1',
  };
  return m[id] ?? 'Unknown';
}

function flvVideoFrameTypeName(t: number): string {
  const m: Record<number, string> = { 1: 'Keyframe', 2: 'Inter frame', 3: 'Disposable inter', 4: 'Generated keyframe', 5: 'Command frame' };
  return m[t] ?? 'Unknown';
}

function flvAvcPacketTypeName(t: number): string {
  const m: Record<number, string> = { 0: 'AVC sequence header', 1: 'AVC NALU', 2: 'AVC end of sequence' };
  return m[t] ?? 'Unknown';
}

function flvSoundFormatName(fmt: number): string {
  const m: Record<number, string> = {
    0: 'Linear PCM', 1: 'ADPCM', 2: 'MP3', 3: 'Linear PCM LE',
    4: 'Nellymoser 16kHz', 5: 'Nellymoser 8kHz', 6: 'Nellymoser',
    7: 'G.711 A-law', 8: 'G.711 μ-law', 10: 'AAC',
    11: 'Speex', 14: 'MP3 8kHz', 15: 'Device-specific',
  };
  return m[fmt] ?? 'Unknown';
}

function flvSoundRateLabel(rate: number): string {
  const m: Record<number, string> = { 0: '5.5 kHz', 1: '11 kHz', 2: '22 kHz', 3: '44 kHz' };
  return m[rate] ?? 'Unknown';
}

// ─── AMF0 ───

function readAmfValue(view: DataView, offset: number, end: number): { value: unknown; bytesRead: number } {
  if (offset >= end || offset >= view.byteLength) return { value: null, bytesRead: 0 };
  const type = view.getUint8(offset);
  switch (type) {
    case 0: // Number (double)
      return offset + 9 <= view.byteLength
        ? { value: view.getFloat64(offset + 1), bytesRead: 9 }
        : { value: null, bytesRead: 0 };
    case 1: // Boolean
      return offset + 2 <= view.byteLength
        ? { value: view.getUint8(offset + 1) !== 0, bytesRead: 2 }
        : { value: null, bytesRead: 0 };
    case 2: { // String
      if (offset + 3 > view.byteLength) return { value: null, bytesRead: 0 };
      const len = view.getUint16(offset + 1);
      if (offset + 3 + len > view.byteLength) return { value: null, bytesRead: 0 };
      const raw = new Uint8Array(view.buffer, view.byteOffset + offset + 3, len);
      return { value: new TextDecoder('utf-8').decode(raw), bytesRead: 3 + len };
    }
    case 3: { // Object
      let pos = offset + 1;
      const obj: Record<string, unknown> = {};
      while (pos + 2 < end) {
        const keyLen = view.getUint16(pos);
        pos += 2;
        if (pos + keyLen >= end) break;
        const key = new TextDecoder('utf-8').decode(
          new Uint8Array(view.buffer, view.byteOffset + pos, keyLen),
        );
        pos += keyLen;
        const r = readAmfValue(view, pos, end);
        if (r.bytesRead === 0) break;
        obj[key] = r.value;
        pos += r.bytesRead;
      }
      // Skip object end marker (0x00 0x00 0x09)
      if (pos + 3 <= end && view.getUint8(pos) === 0 && view.getUint8(pos + 1) === 0 && view.getUint8(pos + 2) === 9) {
        pos += 3;
      }
      return { value: obj, bytesRead: pos - offset };
    }
    case 8: { // ECMA array
      let pos = offset + 1;
      const count = view.getUint32(pos - 1);
      pos += 3; // skip count (already read)
      const arr: Record<string, unknown> = {};
      for (let i = 0; i < count && pos + 2 < end; i++) {
        const keyLen = view.getUint16(pos);
        pos += 2;
        if (pos + keyLen >= end) break;
        const key = new TextDecoder('utf-8').decode(
          new Uint8Array(view.buffer, view.byteOffset + pos, keyLen),
        );
        pos += keyLen;
        const r = readAmfValue(view, pos, end);
        if (r.bytesRead === 0) break;
        arr[key] = r.value;
        pos += r.bytesRead;
      }
      // Skip end marker
      if (pos + 3 <= end && view.getUint8(pos) === 0 && view.getUint8(pos + 1) === 0 && view.getUint8(pos + 2) === 9) {
        pos += 3;
      }
      return { value: arr, bytesRead: pos - offset };
    }
    default:
      return { value: null, bytesRead: 1 };
  }
}

// ─── Video Tag Body ───

export interface ParsedFlvTag {
  tagType: number;
  dataSize: number;
  timestamp: number;
  timestampFull: number;
  offset: number;
  /** H.264/HEVC SPS info extracted from sequence header or keyframe */
  spsInfo?: H264SpsResult | Record<string, unknown> | null;
  /** AAC AudioSpecificConfig */
  audioConfig?: Record<string, unknown> | null;
  /** onMetaData object */
  metadata?: Record<string, unknown> | null;
  pictureType?: string;
  isKeyframe?: boolean;
  codecId?: string;
}

export function parseFlvTagAt(
  fileBytes: Uint8Array,
  offset: number,
): ParsedFlvTag | null {
  if (offset + 11 > fileBytes.length) return null;

  const view = new DataView(fileBytes.buffer, fileBytes.byteOffset + offset, 11);
  const tagType = view.getUint8(0);
  const dataSize = (view.getUint8(1) << 16) | (view.getUint8(2) << 8) | view.getUint8(3);
  const tsLow = (view.getUint8(4) << 16) | (view.getUint8(5) << 8) | view.getUint8(6);
  const tsExt = view.getUint8(7);
  const timestampFull = (tsExt << 24) | tsLow;

  if (dataSize === 0 || offset + 11 + dataSize > fileBytes.length) return null;

  const tag: ParsedFlvTag = {
    tagType, dataSize, timestamp: tsLow, timestampFull, offset,
  };

  const bodyOffset = offset + 11;
  const body = new Uint8Array(fileBytes.buffer, fileBytes.byteOffset + bodyOffset, dataSize);
  const reader = new BitReader(body, 0);

  if (tagType === 9) {
    // ─── Video tag ───
    const frameType = (body[0]! >> 4) & 0x0f;
    const codecId = body[0]! & 0x0f;
    tag.isKeyframe = frameType === 1;
    tag.codecId = flvVideoCodecIdName(codecId);

    if (codecId === 7 && body.length > 5) {
      // AVC
      const avcPacketType = body[1];
      const compTime = (body[2]! << 16) | (body[3]! << 8) | body[4]!;

      if (avcPacketType === 0) {
        // Sequence header — parse SPS from avcC
        const avcC = new Uint8Array(body.buffer, body.byteOffset + 5, body.length - 5);
        // Parse SPS from avcC: skip configurationVersion(1)+profile(1)+compat(1)+level(1)+lengthSizeMinus1(1)
        if (avcC.length > 7) {
          const numSps = avcC[5]! & 0x1f;
          let off = 6;
          for (let i = 0; i < numSps && off + 2 <= avcC.length; i++) {
            const spsLen = (avcC[off]! << 8) | avcC[off + 1]!;
            off += 2;
            if (off + spsLen <= avcC.length) {
              const sps = parseH264SpsNaluPayload(avcC.slice(off, off + spsLen));
              if (sps._actualWidth) {
                tag.spsInfo = sps;
                tag.pictureType = 'I';
                break;
              }
              off += spsLen;
            }
          }
        }
      } else if (avcPacketType === 1) {
        // NAL unit — detect picture type
        const naluData = new Uint8Array(body.buffer, body.byteOffset + 5, body.length - 5);
        const nalus = splitAnnexBNalus(naluData);
        for (const nalu of nalus) {
          if (nalu.length > 1) {
            const nalType = nalu[0]! & 0x1f;
            if (nalType === 7) {
              // SPS in keyframe
              const sps = parseH264SpsNaluPayload(nalu);
              if (sps._actualWidth) tag.spsInfo = sps;
            }
            if (nalType === 5) tag.pictureType = 'I';
            else if (nalType === 1) tag.pictureType = tag.pictureType !== 'I' ? 'P' : 'I';
          }
        }
        if (!tag.pictureType && frameType === 1) tag.pictureType = 'I';
        else if (!tag.pictureType && frameType === 2) tag.pictureType = 'P';
      }
    } else if (codecId === 12 && body.length > 5) {
      // HEVC
      const hvccPacketType = body[1];
      if (hvccPacketType === 0) {
        // hvcC — parse SPS
        const hvcC = new Uint8Array(body.buffer, body.byteOffset + 5, body.length - 5);
        if (hvcC.length > 23) {
          // Skip to SPS array
          const numArrays = hvcC[22];
          let off = 23;
          for (let i = 0; i < (numArrays ?? 0) && off + 3 <= hvcC.length; i++) {
            off++; // array_completeness + NAL type
            const numNalus = (hvcC[off]! << 8) | hvcC[off + 1]!;
            off += 2;
            for (let j = 0; j < numNalus && off + 2 <= hvcC.length; j++) {
              const naluLen = (hvcC[off]! << 8) | hvcC[off + 1]!;
              off += 2;
              if (off + naluLen <= hvcC.length) {
                const sps = parseHevcSpsNaluPayload(hvcC.slice(off, off + naluLen));
                if (sps._actualWidth) { tag.spsInfo = sps; tag.pictureType = 'I'; break; }
                off += naluLen;
              }
            }
            if (tag.spsInfo) break;
          }
        }
      } else if (hvccPacketType === 1 && frameType === 1) {
        tag.pictureType = 'I';
      }
    }
  } else if (tagType === 8) {
    // ─── Audio tag ───
    const soundFormat = (body[0]! >> 4) & 0x0f;
    const soundRate = (body[0]! >> 2) & 0x03;
    const soundSize = (body[0]! >> 1) & 0x01;
    const soundType = body[0]! & 0x01;

    if (soundFormat === 10 && body.length > 1) {
      // AAC
      const aacPacketType = body[1];
      if (aacPacketType === 0 && body.length > 2) {
        // AAC sequence header
        tag.audioConfig = parseAudioSpecificConfig(body.slice(2));
      }
    }
  } else if (tagType === 18 && body.length > 4) {
    // ─── Script tag (onMetaData) ───
    try {
      const result = readAmfValue(
        new DataView(body.buffer, body.byteOffset, body.length),
        0, body.length,
      );
      if (result.value && typeof result.value === 'object') {
        tag.metadata = result.value as Record<string, unknown>;
      }
    } catch { /* AMF0 parse failure is non-fatal */ }
  }

  return tag;
}

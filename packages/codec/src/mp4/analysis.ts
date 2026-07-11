/**
 * MP4/ISO-BMFF container parser — 完整 box 树遍历 + metadata 提取
 *
 * 从旧 lib/core/MP4Parser.js 重构
 */

import { BitReader } from '../binary/reader.js';
import type { MediaAnalysisResult, StreamInfo, FrameInfo, MediaFormat } from '@media-workflow/core';
import { parseH264SpsNaluPayload } from '../h264/sps.js';
import { parseHevcSpsNaluPayload } from '../h265/sps.js';

// ─── Box parser ───

interface Mp4Box {
  type: string;
  size: number;
  headerSize: number;
  data: Uint8Array;
  children: Mp4Box[];
}

function parseBox(data: Uint8Array, offset: number, depth: number): Mp4Box | null {
  if (offset + 8 > data.length) return null;
  const view = new DataView(data.buffer, data.byteOffset + offset);
  let size = view.getUint32(0);
  const type = String.fromCharCode(view.getUint8(4)!, view.getUint8(5)!, view.getUint8(6)!, view.getUint8(7)!);
  let headerSize = 8;

  if (size === 1) {
    // 64-bit size
    if (offset + 16 > data.length) return null;
    const hi = view.getUint32(8);
    const lo = view.getUint32(12);
    size = hi * 0x100000000 + lo;
    headerSize = 16;
  } else if (size === 0) {
    size = data.length - offset;
  }

  if (offset + size > data.length || size < headerSize) return null;

  const boxData = new Uint8Array(data.buffer, data.byteOffset + offset, size);
  const children: Mp4Box[] = [];

  // Container boxes
  const containerTypes = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts', 'udta', 'mvex', 'moof', 'mfra']);
  if (containerTypes.has(type)) {
    let childOff = headerSize;
    while (childOff + 8 <= size) {
      const child = parseBox(boxData, childOff, depth + 1);
      if (!child) break;
      children.push(child);
      childOff += child.size;
    }
  }

  return { type, size, headerSize, data: boxData, children };
}

function findBox(box: Mp4Box, type: string): Mp4Box | undefined {
  if (box.type === type) return box;
  for (const child of box.children) {
    const found = findBox(child, type);
    if (found) return found;
  }
  return undefined;
}

function findBoxes(box: Mp4Box, type: string): Mp4Box[] {
  const result: Mp4Box[] = [];
  if (box.type === type) result.push(box);
  for (const child of box.children) {
    result.push(...findBoxes(child, type));
  }
  return result;
}

// ─── Codec extraction ───

function extractAvc1Info(stsdData: Uint8Array): Record<string, unknown> | null {
  // stsd box: version(1)+flags(3)+entryCount(4)+entries...
  if (stsdData.length < 16) return null;
  const view = new DataView(stsdData.buffer, stsdData.byteOffset, stsdData.byteLength);
  const entryCount = view.getUint32(12);
  if (entryCount === 0) return null;

  // First sample entry: size(4)+type(4)
  let off = 16;
  if (off + 8 > stsdData.length) return null;
  const entryType = String.fromCharCode(
    view.getUint8(off + 4)!, view.getUint8(off + 5)!, view.getUint8(off + 6)!, view.getUint8(off + 7)!,
  );
  off += 8;
  off += 6; // reserved
  off += 2; // data_reference_index
  off += 2; // version
  off += 2; // revision
  off += 4; // vendor
  off += 4; // temporal quality
  off += 4; // spatial quality
  const width = view.getUint16(off);
  const height = view.getUint16(off + 2);
  off += 12; // width + height + horizontal/vertical resolution
  off += 4; // data size
  off += 2; // frame count
  off += 32; // compressor name
  off += 2; // depth
  off += 2; // color table id

  // Codec-specific box
  if (off + 8 <= stsdData.length) {
    const boxLen = view.getUint32(off);
    const boxType = String.fromCharCode(
      view.getUint8(off + 4)!, view.getUint8(off + 5)!, view.getUint8(off + 6)!, view.getUint8(off + 7)!,
    );
    if (boxType === 'avcC' && boxLen >= 7) {
      // avcC: version(1)+profile(1)+compat(1)+level(1)+lengthSize(1) + SPS list
      const avcCData = new Uint8Array(stsdData.buffer, stsdData.byteOffset + off + 8, Math.min(boxLen - 8, stsdData.length - off - 8));
      if (avcCData.length > 5) {
        const numSps = avcCData[5]! & 0x1f;
        let spsOff = 6;
        for (let i = 0; i < numSps && spsOff + 2 <= avcCData.length; i++) {
          const spsLen = (avcCData[spsOff]! << 8) | avcCData[spsOff + 1]!;
          spsOff += 2;
          if (spsOff + spsLen <= avcCData.length) {
            const sps = parseH264SpsNaluPayload(avcCData.slice(spsOff, spsOff + spsLen));
            if (sps._actualWidth) {
              return { ...sps, entryType, width: sps._actualWidth, height: sps._actualHeight, avcC: avcCData.slice() };
            }
            spsOff += spsLen;
          }
        }
      }
      return { entryType, width, height, avcC: avcCData.slice() };
    }
    if (boxType === 'hvcC') {
      const hvcCData = new Uint8Array(stsdData.buffer, stsdData.byteOffset + off + 8, Math.min(boxLen - 8, stsdData.length - off - 8));
      if (hvcCData.length > 23) {
        const numArrays = hvcCData[22];
        let spsOff = 23;
        for (let i = 0; i < (numArrays ?? 0) && spsOff + 3 <= hvcCData.length; i++) {
          spsOff++;
          const numNalus = (hvcCData[spsOff]! << 8) | hvcCData[spsOff + 1]!;
          spsOff += 2;
          for (let j = 0; j < numNalus && spsOff + 2 <= hvcCData.length; j++) {
            const naluLen = (hvcCData[spsOff]! << 8) | hvcCData[spsOff + 1]!;
            spsOff += 2;
            if (spsOff + naluLen <= hvcCData.length) {
              const sps = parseHevcSpsNaluPayload(hvcCData.slice(spsOff, spsOff + naluLen));
              if (sps._actualWidth) return { ...sps, entryType, width: sps._actualWidth, height: sps._actualHeight };
              spsOff += naluLen;
            }
          }
        }
      }
      return { entryType, width, height };
    }
  }

  return { entryType, width, height };
}

function extractMp4aInfo(stsdData: Uint8Array): Record<string, unknown> | null {
  if (stsdData.length < 16) return null;
  const view = new DataView(stsdData.buffer, stsdData.byteOffset, stsdData.byteLength);
  const entryCount = view.getUint32(12);
  if (entryCount === 0) return null;

  let off = 16 + 8 + 6 + 2; // entry header + reserved + data_reference_index
  off += 2; // version
  off += 2; // revision
  off += 4; // vendor
  const channels = view.getUint16(off);
  const sampleSize = view.getUint16(off + 2);
  off += 4;
  off += 4; // compression id + packet size
  const sampleRate = view.getUint32(off) >>> 16;
  off += 4;

  // esds box
  if (off + 8 <= stsdData.length) {
    const boxLen = view.getUint32(off);
    const boxType = String.fromCharCode(view.getUint8(off + 4)!, view.getUint8(off + 5)!, view.getUint8(off + 6)!, view.getUint8(off + 7)!);
    if (boxType === 'esds' && boxLen > 12) {
      // esds: version(1)+flags(3)+ES_Descriptor...
      const esdsData = new Uint8Array(stsdData.buffer, stsdData.byteOffset + off + 8, Math.min(boxLen - 8, stsdData.length - off - 8));
      // Find decSpecificInfo tag (0x05)
      for (let i = 0; i + 2 < esdsData.length; i++) {
        if (esdsData[i] === 0x05) {
          const descriptor = readDescriptorLength(esdsData, i + 1);
          if (
            descriptor &&
            descriptor.length >= 2 &&
            descriptor.dataOffset + descriptor.length <= esdsData.length
          ) {
            const asc = esdsData.slice(descriptor.dataOffset, descriptor.dataOffset + descriptor.length);
            return {
              ...parseAudioSpecificConfig(asc),
              asc,
            };
          }
        }
      }
    }
  }

  return { channels, sampleSize, sampleRate };
}

function readDescriptorLength(
  data: Uint8Array,
  offset: number,
): { length: number; dataOffset: number } | null {
  let length = 0;
  let cursor = offset;
  for (let count = 0; count < 4 && cursor < data.length; count++, cursor++) {
    const byte = data[cursor]!;
    length = (length << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return { length, dataOffset: cursor + 1 };
    }
  }
  return null;
}

import { parseAudioSpecificConfig } from '../aac/asc.js';

function parseTrackIdentity(trak: Mp4Box, fallback: number): {
  trackId: number;
  timeScale?: number;
  durationMs?: number;
} {
  const tkhd = findBox(trak, 'tkhd');
  let trackId = fallback;
  if (tkhd && tkhd.data.length >= 24) {
    const view = new DataView(tkhd.data.buffer, tkhd.data.byteOffset, tkhd.data.byteLength);
    const version = view.getUint8(8);
    const offset = version === 1 ? 28 : 20;
    if (offset + 4 <= tkhd.data.length) trackId = view.getUint32(offset);
  }

  const mdhd = findBox(trak, 'mdhd');
  if (!mdhd || mdhd.data.length < 28) return { trackId };
  const view = new DataView(mdhd.data.buffer, mdhd.data.byteOffset, mdhd.data.byteLength);
  const version = view.getUint8(8);
  const timeScaleOffset = version === 1 ? 28 : 20;
  const durationOffset = version === 1 ? 32 : 24;
  if (durationOffset + (version === 1 ? 8 : 4) > mdhd.data.length) return { trackId };
  const trackTimeScale = view.getUint32(timeScaleOffset);
  const duration = version === 1
    ? view.getUint32(durationOffset) * 0x100000000 + view.getUint32(durationOffset + 4)
    : view.getUint32(durationOffset);
  return {
    trackId,
    timeScale: trackTimeScale > 0 ? trackTimeScale : undefined,
    durationMs: trackTimeScale > 0 ? (duration / trackTimeScale) * 1_000 : undefined,
  };
}

interface SampleToChunkEntry {
  firstChunk: number;
  samplesPerChunk: number;
}

function parseChunkOffsets(box: Mp4Box | undefined): number[] {
  if (!box || box.data.length < 16) return [];
  const view = new DataView(box.data.buffer, box.data.byteOffset, box.data.byteLength);
  const entryCount = view.getUint32(12);
  const width = box.type === 'co64' ? 8 : 4;
  const offsets: number[] = [];
  for (let index = 0; index < entryCount && 16 + (index + 1) * width <= box.data.length; index++) {
    if (width === 8) {
      offsets.push(view.getUint32(16 + index * 8) * 0x100000000 + view.getUint32(20 + index * 8));
    } else {
      offsets.push(view.getUint32(16 + index * 4));
    }
  }
  return offsets;
}

function parseSampleSizes(box: Mp4Box | undefined): number[] {
  if (!box || box.data.length < 20) return [];
  const view = new DataView(box.data.buffer, box.data.byteOffset, box.data.byteLength);
  const sampleSize = view.getUint32(12);
  const sampleCount = view.getUint32(16);
  if (sampleSize > 0) return Array(sampleCount).fill(sampleSize);
  const sizes: number[] = [];
  for (let index = 0; index < sampleCount && 20 + (index + 1) * 4 <= box.data.length; index++) {
    sizes.push(view.getUint32(20 + index * 4));
  }
  return sizes;
}

function parseSampleToChunk(box: Mp4Box | undefined): SampleToChunkEntry[] {
  if (!box || box.data.length < 16) return [];
  const view = new DataView(box.data.buffer, box.data.byteOffset, box.data.byteLength);
  const entryCount = view.getUint32(12);
  const entries: SampleToChunkEntry[] = [];
  for (let index = 0; index < entryCount && 16 + (index + 1) * 12 <= box.data.length; index++) {
    entries.push({
      firstChunk: view.getUint32(16 + index * 12),
      samplesPerChunk: view.getUint32(20 + index * 12),
    });
  }
  return entries;
}

function buildSampleOffsets(
  chunkOffsets: number[],
  sampleSizes: number[],
  sampleToChunk: SampleToChunkEntry[],
): number[] {
  const offsets: number[] = [];
  let sampleIndex = 0;
  for (let chunkIndex = 0; chunkIndex < chunkOffsets.length && sampleIndex < sampleSizes.length; chunkIndex++) {
    const chunkNumber = chunkIndex + 1;
    const mapping = [...sampleToChunk]
      .reverse()
      .find(entry => entry.firstChunk <= chunkNumber);
    const samplesPerChunk = mapping?.samplesPerChunk ?? 1;
    let offset = chunkOffsets[chunkIndex]!;
    for (let inChunk = 0; inChunk < samplesPerChunk && sampleIndex < sampleSizes.length; inChunk++) {
      offsets.push(offset);
      offset += sampleSizes[sampleIndex]!;
      sampleIndex++;
    }
  }
  return offsets;
}

function expandTimeTable(box: Mp4Box | undefined, sampleCount: number): number[] {
  if (!box || box.data.length < 16) return Array(sampleCount).fill(0);
  const view = new DataView(box.data.buffer, box.data.byteOffset, box.data.byteLength);
  const entryCount = view.getUint32(12);
  const values: number[] = [];
  for (let index = 0; index < entryCount && 16 + (index + 1) * 8 <= box.data.length; index++) {
    const count = view.getUint32(16 + index * 8);
    const value = view.getUint32(20 + index * 8);
    for (let repeat = 0; repeat < count && values.length < sampleCount; repeat++) values.push(value);
  }
  while (values.length < sampleCount) values.push(values.at(-1) ?? 0);
  return values;
}

function expandCompositionOffsets(box: Mp4Box | undefined, sampleCount: number): number[] {
  if (!box || box.data.length < 16) return Array(sampleCount).fill(0);
  const view = new DataView(box.data.buffer, box.data.byteOffset, box.data.byteLength);
  const version = view.getUint8(8);
  const entryCount = view.getUint32(12);
  const values: number[] = [];
  for (let index = 0; index < entryCount && 16 + (index + 1) * 8 <= box.data.length; index++) {
    const count = view.getUint32(16 + index * 8);
    const value = version === 1
      ? view.getInt32(20 + index * 8)
      : view.getUint32(20 + index * 8);
    for (let repeat = 0; repeat < count && values.length < sampleCount; repeat++) values.push(value);
  }
  while (values.length < sampleCount) values.push(0);
  return values;
}

function parseSyncSamples(box: Mp4Box | undefined): Set<number> {
  if (!box || box.data.length < 16) return new Set();
  const view = new DataView(box.data.buffer, box.data.byteOffset, box.data.byteLength);
  const entryCount = view.getUint32(12);
  const samples = new Set<number>();
  for (let index = 0; index < entryCount && 16 + (index + 1) * 4 <= box.data.length; index++) {
    samples.add(view.getUint32(16 + index * 4));
  }
  return samples;
}

// ─── Main analysis ───

export function parseIsoBmffForAnalysis(fileBytes: Uint8Array): MediaAnalysisResult {
  const topLevelBoxes: Mp4Box[] = [];
  let topLevelOffset = 0;
  while (topLevelOffset + 8 <= fileBytes.byteLength) {
    const box = parseBox(fileBytes, topLevelOffset, 0);
    if (!box) break;
    topLevelBoxes.push(box);
    topLevelOffset += box.size;
  }
  if (topLevelBoxes.length === 0) {
    return { format: { container: 'mp4', subtype: 'mp4', details: {} }, streams: [], frames: [], formatSpecific: {} };
  }
  const root: Mp4Box = {
    type: 'root',
    size: fileBytes.byteLength,
    headerSize: 0,
    data: fileBytes,
    children: topLevelBoxes,
  };

  // ftyp
  const ftyp = findBox(root, 'ftyp');
  const majorBrand = ftyp ? String.fromCharCode(ftyp.data[8]!, ftyp.data[9]!, ftyp.data[10]!, ftyp.data[11]!) : 'unknown';

  // mvhd
  const mvhd = findBox(root, 'mvhd');
  let duration = 0;
  let timeScale = 1;
  if (mvhd && mvhd.data.length >= 20) {
    const view = new DataView(mvhd.data.buffer, mvhd.data.byteOffset, mvhd.data.byteLength);
    const version = view.getUint8(8);
    if (version === 0) {
      timeScale = view.getUint32(20);
      duration = view.getUint32(24);
    } else if (mvhd.data.length >= 32) {
      timeScale = view.getUint32(28);
      const hi = view.getUint32(32);
      const lo = view.getUint32(36);
      duration = hi * 0x100000000 + lo;
    }
  }

  // Tracks
  const streams: StreamInfo[] = [];
  const frames: FrameInfo[] = [];
  const traks = findBoxes(root, 'trak');

  for (const trak of traks) {
    const hdlr = findBox(trak, 'hdlr');
    if (!hdlr || hdlr.data.length < 20) continue;
    const handlerType = String.fromCharCode(
      hdlr.data[16]!,
      hdlr.data[17]!,
      hdlr.data[18]!,
      hdlr.data[19]!,
    );
    const isVideo = handlerType === 'vide';
    const isAudio = handlerType === 'soun';
    if (!isVideo && !isAudio) continue;

    // stsd
    const stsd = findBox(trak, 'stsd');
    let codecInfo: Record<string, unknown> | null = null;
    if (stsd && isVideo) codecInfo = extractAvc1Info(stsd.data);
    else if (stsd && isAudio) codecInfo = extractMp4aInfo(stsd.data);
    const audioSampleRate = Number(
      codecInfo?._samplingFrequency_value ?? codecInfo?.sampleRate,
    );
    const audioChannels = Number(
      codecInfo?._channelConfiguration_value ?? codecInfo?.channels,
    );

    // stco/co64 — chunk offsets
    const stco = findBox(trak, 'stco') ?? findBox(trak, 'co64');
    const stsz = findBox(trak, 'stsz');
    const stsc = findBox(trak, 'stsc');
    const stts = findBox(trak, 'stts');
    const ctts = findBox(trak, 'ctts');
    const stss = findBox(trak, 'stss');
    const sampleSizes = parseSampleSizes(stsz);
    const sampleOffsets = buildSampleOffsets(
      parseChunkOffsets(stco),
      sampleSizes,
      parseSampleToChunk(stsc),
    );

    // Build frames from offsets
    const streamIdx = streams.length;
    const identity = parseTrackIdentity(trak, streamIdx);
    const entryType = String(codecInfo?.entryType ?? '');
    const isHevc = entryType === 'hvc1' || entryType === 'hev1';
    const sampleDeltas = expandTimeTable(stts, sampleSizes.length);
    const compositionOffsets = expandCompositionOffsets(ctts, sampleSizes.length);
    const syncSamples = parseSyncSamples(stss);
    const trackTimeScale = identity.timeScale ?? timeScale;
    let dtsTicks = 0;
    for (let i = 0; i < sampleSizes.length; i++) {
      const delta = sampleDeltas[i] ?? 0;
      const ptsTicks = dtsTicks + (compositionOffsets[i] ?? 0);
      frames.push({
        index: frames.length,
        streamIndex: streamIdx,
        kind: isVideo ? 'video' : 'audio',
        dts: trackTimeScale > 0 ? (dtsTicks / trackTimeScale) * 1_000 : 0,
        pts: trackTimeScale > 0 ? (ptsTicks / trackTimeScale) * 1_000 : 0,
        duration: trackTimeScale > 0 ? (delta / trackTimeScale) * 1_000 : undefined,
        offset: sampleOffsets[i] ?? 0,
        size: sampleSizes[i]!,
        isKey: !isVideo || syncSamples.size === 0 || syncSamples.has(i + 1),
      });
      dtsTicks += delta;
    }

    streams.push({
      index: streamIdx,
      sourceId: identity.trackId,
      kind: isVideo ? 'video' : 'audio',
      codec: isVideo ? (isHevc ? 'H.265' : 'H.264') : 'AAC',
      codecFamily: isVideo ? (isHevc ? 'h265' : 'h264') : 'aac',
      codecConfig: isVideo
        ? (codecInfo?.avcC as Uint8Array | undefined) ?? null
        : (codecInfo?.asc as Uint8Array | undefined) ?? null,
      durationMs: identity.durationMs,
      sampleCount: sampleSizes.length,
      timeBase: identity.timeScale
        ? { numerator: 1, denominator: identity.timeScale }
        : undefined,
      metadata: { trackId: identity.trackId },
      video: isVideo && codecInfo ? {
        width: (codecInfo.width as number) ?? (codecInfo._actualWidth as number) ?? 0,
        height: (codecInfo.height as number) ?? (codecInfo._actualHeight as number) ?? 0,
        profile: String(
          codecInfo.profile_idc ??
          codecInfo.profile_tier_level ??
          codecInfo._profile_idc_value ??
          '',
        ),
        level: String(codecInfo.level_idc ?? codecInfo._level_idc_value ?? ''),
        bitDepth: Number(codecInfo._bit_depth_luma_value) || undefined,
        chromaFormat: Number(codecInfo._chroma_format_idc_value) || undefined,
      } : undefined,
      audio: isAudio &&
        audioSampleRate > 0 &&
        audioChannels > 0
        ? {
            sampleRate: audioSampleRate,
            channels: audioChannels,
            profile: String(codecInfo?.audioObjectTypeName ?? ''),
          }
        : undefined,
    });
  }

  const format: MediaFormat = {
    container: 'mp4',
    subtype: majorBrand,
    details: { majorBrand, timeScale, duration },
  };

  return {
    format, streams, frames,
    formatSpecific: { boxTree: root, sampleCount: frames.length },
    fileSize: fileBytes.byteLength,
  };
}

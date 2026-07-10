/**
 * FLV container analysis — full tag parsing chain.
 */

import type { MediaAnalysisResult, StreamInfo, FrameInfo, MediaFormat } from '@media-workflow/core';
import type { H264SpsResult } from '../types.js';
import { parseFlvTagAt, type ParsedFlvTag } from './tag.js';

// ─── FLV File Header ───

export interface FlvHeader {
  signature: string;
  version: number;
  hasAudio: boolean;
  hasVideo: boolean;
  dataOffset: number;
}

export function parseFlvFileHeader(data: Uint8Array, offset = 0): FlvHeader {
  if (offset < 0 || offset + 9 > data.byteLength) {
    throw new RangeError('FLV header requires at least 9 bytes.');
  }
  const view = new DataView(data.buffer, data.byteOffset + offset, 9);
  const flags = view.getUint8(4);
  return {
    signature: String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2)),
    version: view.getUint8(3),
    hasAudio: (flags & 0x04) !== 0,
    hasVideo: (flags & 0x01) !== 0,
    dataOffset: view.getUint32(5),
  };
}

// ─── Main Analysis ───

export function parseFlvFileForAnalysis(fileBytes: Uint8Array): MediaAnalysisResult {
  let offset = 0;
  const header = parseFlvFileHeader(fileBytes, offset);
  offset += 9 + 4; // header + PreviousTagSize0

  const frames: FrameInfo[] = [];
  let hasVideo = false, hasAudio = false;
  let maxTs = 0;
  let spsInfo: H264SpsResult | Record<string, unknown> | null = null;
  let audioConfig: Record<string, unknown> | null = null;
  let frameIndex = 0;

  while (offset + 11 <= fileBytes.length) {
    const tag = parseFlvTagAt(fileBytes, offset);
    if (!tag || tag.dataSize === 0) break;

    const ts = tag.timestampFull;
    if (ts > maxTs) maxTs = ts;

    if (tag.tagType === 9) {
      hasVideo = true;
      if (tag.spsInfo && !spsInfo) spsInfo = tag.spsInfo;
    } else if (tag.tagType === 8) {
      hasAudio = true;
      if (tag.audioConfig && !audioConfig) audioConfig = tag.audioConfig;
    }

    if (tag.tagType === 9 || tag.tagType === 8) {
      frames.push({
        index: frameIndex++,
        streamIndex: tag.tagType === 9 ? 0 : 1,
        kind: tag.tagType === 9 ? 'video' : 'audio',
        dts: ts,
        pts: ts,
        offset: tag.offset,
        size: tag.dataSize,
        isKey: tag.isKeyframe ?? false,
        pictureType: tag.pictureType,
      });
    }

    offset += 11 + tag.dataSize + 4;
  }

  const streams: StreamInfo[] = [];
  const format: MediaFormat = { container: 'flv', subtype: 'flv', details: { header } };

  if (hasVideo) {
    streams.push({
      index: 0, sourceId: 'video', kind: 'video',
      codec: spsInfo ? 'H.264' : 'H.264',
      codecFamily: 'h264',
      codecConfig: null,
      durationMs: maxTs,
      sampleCount: frames.filter(frame => frame.kind === 'video').length,
      timeBase: { numerator: 1, denominator: 1_000 },
      video: spsInfo ? {
        width: Number(spsInfo._actualWidth) || 0,
        height: Number(spsInfo._actualHeight) || 0,
        profile: String(spsInfo.profile_idc ?? spsInfo._profile_idc_value ?? ''),
        level: String(spsInfo.level_idc ?? spsInfo._level_idc_value ?? ''),
        bitDepth: Number(spsInfo._bit_depth_luma_value) || undefined,
        chromaFormat: Number(spsInfo._chroma_format_idc_value) || undefined,
      } : undefined,
    });
  }

  if (hasAudio) {
    streams.push({
      index: hasVideo ? 1 : 0, sourceId: 'audio', kind: 'audio',
      codec: 'AAC', codecFamily: 'aac', codecConfig: null,
      durationMs: maxTs,
      sampleCount: frames.filter(frame => frame.kind === 'audio').length,
      timeBase: { numerator: 1, denominator: 1_000 },
      audio: audioConfig &&
        Number(audioConfig._samplingFrequency_value) > 0 &&
        Number(audioConfig._channelConfiguration_value) > 0
        ? {
            sampleRate: Number(audioConfig._samplingFrequency_value),
            channels: Number(audioConfig._channelConfiguration_value),
            profile: String(audioConfig.audioObjectTypeName ?? ''),
          }
        : undefined,
    });
  }

  for (const frame of frames) {
    frame.streamIndex = frame.kind === 'video' ? 0 : hasVideo ? 1 : 0;
  }

  return {
    format, streams, frames,
    formatSpecific: { header, maxTimestamp: maxTs, tagCount: frames.length },
    fileSize: fileBytes.byteLength,
  };
}

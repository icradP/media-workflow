/**
 * FLV container analysis — full tag parsing chain.
 */

import type { MediaAnalysisResult, StreamInfo, FrameInfo, MediaFormat } from '@media-workflow/core';
import type { H264SpsResult } from '../types.js';
import { parseMp3FrameHeader } from '../audio/minimal.js';
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
  let videoCodecConfig: Uint8Array | null = null;
  let audioCodecConfig: Uint8Array | null = null;
  let frameIndex = 0;
  let audioSoundFormat: number | undefined;
  let mp3AudioInfo: { sampleRate: number; channels: number } | undefined;
  let scriptMetadata: Record<string, unknown> | null = null;

  while (offset + 11 <= fileBytes.length) {
    const tag = parseFlvTagAt(fileBytes, offset);
    if (!tag || tag.dataSize === 0) break;

    const ts = tag.timestampFull;
    if (ts > maxTs) maxTs = ts;

    if (tag.tagType === 9) {
      hasVideo = true;
      if (tag.spsInfo && !spsInfo) spsInfo = tag.spsInfo;
      if (tag.avcSequenceHeader && !videoCodecConfig) {
        videoCodecConfig = tag.avcSequenceHeader;
      }
    } else if (tag.tagType === 8) {
      hasAudio = true;
      if (tag.soundFormat !== undefined && audioSoundFormat === undefined) {
        audioSoundFormat = tag.soundFormat;
      }
      if (tag.audioConfig && !audioConfig) audioConfig = tag.audioConfig;
      if (tag.aacSequenceHeader && !audioCodecConfig) {
        audioCodecConfig = tag.aacSequenceHeader;
      }
      if (tag.soundFormat === 2 && !mp3AudioInfo) {
        mp3AudioInfo = inferMp3InfoFromFlvTag(fileBytes, tag);
      }
    } else if (tag.tagType === 18 && tag.metadata) {
      scriptMetadata = { ...(scriptMetadata ?? {}), ...tag.metadata };
    }

    if (tag.tagType === 9 || tag.tagType === 8) {
      const payload = extractMediaPayload(fileBytes, tag);
      if (payload) {
        frames.push({
          index: frameIndex++,
          streamIndex: tag.tagType === 9 ? 0 : 1,
          kind: tag.tagType === 9 ? 'video' : 'audio',
          dts: ts,
          pts: payload.pts,
          offset: payload.offset,
          size: payload.data.byteLength,
          isKey: tag.isKeyframe ?? false,
          pictureType: tag.pictureType,
          rawData: payload.data,
          dataOrigin: 'demuxed_payload',
          metadata: {
            flvAvcPacketType: tag.avcPacketType,
            flvSoundFormat: tag.soundFormat,
          },
        });
      }
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
      codecConfig: videoCodecConfig,
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
    const audioMeta = resolveFlvAudioStreamInfo({
      soundFormat: audioSoundFormat ?? readScriptAudioCodecId(scriptMetadata),
      audioConfig,
      audioCodecConfig,
      mp3AudioInfo,
      scriptMetadata,
      maxTs,
      audioSampleCount: frames.filter(frame => frame.kind === 'audio').length,
      hasVideo,
    });
    streams.push(audioMeta);
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

function extractMediaPayload(
  fileBytes: Uint8Array,
  tag: ParsedFlvTag,
): { offset: number; pts: number; data: Uint8Array } | null {
  const bodyOffset = tag.offset + 11;
  const bodyEnd = bodyOffset + tag.dataSize;
  if (bodyEnd > fileBytes.byteLength || tag.dataSize <= 0) return null;
  const body = fileBytes.subarray(bodyOffset, bodyEnd);

  if (tag.tagType === 9) {
    if (body.length < 1) return null;
    const codecId = body[0]! & 0x0f;
    if (codecId === 7 || codecId === 12) {
      if (body.length <= 5 || body[1] !== 1) return null;
      const compositionTime = signedInt24(body[2]!, body[3]!, body[4]!);
      return {
        offset: bodyOffset + 5,
        pts: tag.timestampFull + compositionTime,
        data: body.subarray(5),
      };
    }
    return {
      offset: bodyOffset + 1,
      pts: tag.timestampFull,
      data: body.subarray(1),
    };
  }

  if (tag.tagType === 8) {
    if (body.length < 1) return null;
    const soundFormat = (body[0]! >> 4) & 0x0f;
    if (soundFormat === 10) {
      if (body.length <= 2 || body[1] !== 1) return null;
      return {
        offset: bodyOffset + 2,
        pts: tag.timestampFull,
        data: body.subarray(2),
      };
    }
    return {
      offset: bodyOffset + 1,
      pts: tag.timestampFull,
      data: body.subarray(1),
    };
  }

  return null;
}

function signedInt24(high: number, middle: number, low: number): number {
  const value = (high << 16) | (middle << 8) | low;
  return (value & 0x800000) !== 0 ? value - 0x1000000 : value;
}

function inferMp3InfoFromFlvTag(
  fileBytes: Uint8Array,
  tag: ParsedFlvTag,
): { sampleRate: number; channels: number } | undefined {
  const bodyOffset = tag.offset + 11;
  const bodyEnd = bodyOffset + tag.dataSize;
  if (bodyEnd > fileBytes.byteLength || tag.dataSize <= 1) return undefined;
  const payload = fileBytes.subarray(bodyOffset + 1, bodyEnd);
  const header = parseMp3FrameHeader(payload, 0) ??
    parseMp3FrameHeader(payload, 1);
  if (!header) return undefined;
  return { sampleRate: header.sampleRate, channels: header.channels };
}

function resolveFlvAudioStreamInfo(options: {
  soundFormat?: number;
  audioConfig: Record<string, unknown> | null;
  audioCodecConfig: Uint8Array | null;
  mp3AudioInfo?: { sampleRate: number; channels: number };
  scriptMetadata?: Record<string, unknown> | null;
  maxTs: number;
  audioSampleCount: number;
  hasVideo: boolean;
}): StreamInfo {
  const soundFormat = options.soundFormat ?? 10;
  const index = options.hasVideo ? 1 : 0;
  const scriptAudio = readScriptAudioInfo(options.scriptMetadata);

  if (soundFormat === 2 || soundFormat === 14) {
    return {
      index,
      sourceId: 'audio',
      kind: 'audio',
      codec: 'MP3',
      codecFamily: 'mp3',
      codecConfig: null,
      durationMs: options.maxTs,
      sampleCount: options.audioSampleCount,
      timeBase: { numerator: 1, denominator: 1_000 },
      metadata: { flvSoundFormat: soundFormat },
      audio: options.mp3AudioInfo ?? scriptAudio,
    };
  }

  if (soundFormat === 7 || soundFormat === 8) {
    const law = soundFormat === 7 ? 'alaw' : 'ulaw';
    return {
      index,
      sourceId: 'audio',
      kind: 'audio',
      codec: law === 'alaw' ? 'G.711 A-law' : 'G.711 μ-law',
      codecFamily: 'g711',
      codecConfig: null,
      durationMs: options.maxTs,
      sampleCount: options.audioSampleCount,
      timeBase: { numerator: 1, denominator: 8_000 },
      metadata: { 'g711.law': law, flvSoundFormat: soundFormat },
      audio: { sampleRate: 8_000, channels: 1 },
    };
  }

  const parsedAudio = options.audioConfig &&
    Number(options.audioConfig._samplingFrequency_value) > 0 &&
    Number(options.audioConfig._channelConfiguration_value) > 0
    ? {
        sampleRate: Number(options.audioConfig._samplingFrequency_value),
        channels: Number(options.audioConfig._channelConfiguration_value),
        profile: String(options.audioConfig.audioObjectTypeName ?? ''),
      }
    : scriptAudio;

  return {
    index,
    sourceId: 'audio',
    kind: 'audio',
    codec: 'AAC',
    codecFamily: 'aac',
    codecConfig: options.audioCodecConfig,
    durationMs: options.maxTs,
    sampleCount: options.audioSampleCount,
    timeBase: { numerator: 1, denominator: 1_000 },
    metadata: {
      flvSoundFormat: soundFormat,
      flvAudioConfig: options.audioConfig ?? undefined,
    },
    audio: parsedAudio,
  };
}

function readScriptAudioInfo(
  metadata: Record<string, unknown> | null | undefined,
): { sampleRate: number; channels: number } | undefined {
  if (!metadata) return undefined;
  const sampleRate = Number(
    metadata.audiosamplerate ??
    metadata.audioSampleRate ??
    metadata.audio_sample_rate ??
    0,
  );
  if (sampleRate <= 0) return undefined;
  const stereo = metadata.stereo;
  const channels = stereo === true || stereo === 1 || stereo === 'true'
    ? 2
    : stereo === false || stereo === 0 || stereo === 'false'
      ? 1
      : Number(metadata.audiochannels ?? metadata.audioChannels ?? 1) || 1;
  return { sampleRate, channels };
}

function readScriptAudioCodecId(
  metadata: Record<string, unknown> | null | undefined,
): number | undefined {
  if (!metadata) return undefined;
  const codecId = Number(metadata.audiocodecid ?? metadata.audioCodecId ?? NaN);
  if (!Number.isFinite(codecId)) return undefined;
  const mapped: Record<number, number> = {
    2: 2,
    7: 7,
    8: 8,
    10: 10,
    14: 14,
  };
  return mapped[codecId];
}

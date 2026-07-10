/**
 * Pure audio format parsers — WAV, FLAC, MP3, Opus header extraction.
 */

import type { MediaAnalysisResult, StreamInfo } from '@media-workflow/core';

function parseWavHeader(data: Uint8Array): StreamInfo | null {
  if (data.length < 44) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const audioFormat = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const byteRate = view.getUint32(28, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataSize = view.getUint32(40, true);
  const durationMs = byteRate > 0 ? (dataSize / byteRate) * 1_000 : undefined;
  const sampleCount = channels > 0 && bitsPerSample > 0
    ? Math.floor(dataSize / (channels * (bitsPerSample / 8)))
    : undefined;
  const codecName = audioFormat === 1 ? 'PCM' : audioFormat === 3 ? 'IEEE Float' : `WAV format ${audioFormat}`;
  return {
    index: 0, sourceId: 0, kind: 'audio',
    codec: codecName, codecFamily: audioFormat === 1 || audioFormat === 3 ? 'pcm' : 'unknown',
    codecConfig: null,
    durationMs,
    bitrate: byteRate > 0 ? byteRate * 8 : undefined,
    sampleCount,
    timeBase: sampleRate > 0 ? { numerator: 1, denominator: sampleRate } : undefined,
    metadata: { bitsPerSample },
    audio: { sampleRate, channels },
  };
}

function parseFlacHeader(data: Uint8Array): StreamInfo | null {
  // FLAC: "fLaC" at offset 0, then metadata blocks
  if (data.length < 42) return null;
  // STREAMINFO block starts at offset 4 (after "fLaC" + block header)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // STREAMINFO: minBlockSize(16) maxBlockSize(16) minFrameSize(24) maxFrameSize(24)
  const sampleRateRaw = view.getUint32(14);
  const sampleRate = sampleRateRaw >> 12;
  const channelsRaw = view.getUint8(18)!;
  const channels = ((channelsRaw >> 1) & 0x07) + 1;
  const bitsPerSample = ((channelsRaw & 0x01) << 4) | ((view.getUint8(19)! >> 4) & 0x0f) + 1;
  return {
    index: 0, sourceId: 0, kind: 'audio',
    codec: 'FLAC', codecFamily: 'unknown',
    codecConfig: null,
    timeBase: sampleRate > 0 ? { numerator: 1, denominator: sampleRate } : undefined,
    audio: { sampleRate, channels },
  };
}

function parseMp3Header(data: Uint8Array): StreamInfo | null {
  if (data.length < 4) return null;
  const firstOffset = findFirstMp3Frame(data);
  if (firstOffset < 0) return null;
  const first = parseMp3FrameHeader(data, firstOffset);
  if (!first) return null;

  let frameCount = 0;
  let offset = firstOffset;
  while (offset + 4 <= data.byteLength) {
    const frame = parseMp3FrameHeader(data, offset);
    if (!frame) {
      offset++;
      continue;
    }
    frameCount++;
    offset += frame.frameLength;
  }
  const durationMs = frameCount > 0
    ? (frameCount * first.samplesPerFrame / first.sampleRate) * 1_000
    : ((data.byteLength - firstOffset) * 8 / first.bitrate) * 1_000;
  return {
    index: 0, sourceId: 0, kind: 'audio',
    codec: 'MP3', codecFamily: 'mp3',
    codecConfig: null,
    durationMs,
    bitrate: first.bitrate,
    sampleCount: frameCount,
    timeBase: { numerator: 1, denominator: first.sampleRate },
    audio: {
      sampleRate: first.sampleRate,
      channels: first.channels,
      samplesPerFrame: first.samplesPerFrame,
    },
  };
}

interface Mp3FrameHeader {
  sampleRate: number;
  channels: number;
  bitrate: number;
  samplesPerFrame: number;
  frameLength: number;
}

function findFirstMp3Frame(data: Uint8Array): number {
  let offset = 0;
  if (
    data.length >= 10 &&
    data[0] === 0x49 &&
    data[1] === 0x44 &&
    data[2] === 0x33
  ) {
    const tagSize =
      ((data[6]! & 0x7f) << 21) |
      ((data[7]! & 0x7f) << 14) |
      ((data[8]! & 0x7f) << 7) |
      (data[9]! & 0x7f);
    offset = 10 + tagSize + ((data[5]! & 0x10) !== 0 ? 10 : 0);
  }
  for (; offset + 4 <= data.length; offset++) {
    if (parseMp3FrameHeader(data, offset)) return offset;
  }
  return -1;
}

function parseMp3FrameHeader(data: Uint8Array, offset: number): Mp3FrameHeader | null {
  if (offset + 4 > data.length) return null;
  const header =
    (data[offset]! << 24) |
    (data[offset + 1]! << 16) |
    (data[offset + 2]! << 8) |
    data[offset + 3]!;
  if (((header >>> 21) & 0x7ff) !== 0x7ff) return null;

  const versionBits = (header >> 19) & 3;
  const layerBits = (header >> 17) & 3;
  const bitrateIndex = (header >> 12) & 0x0f;
  const sampleRateIndex = (header >> 10) & 3;
  const padding = (header >> 9) & 1;
  const channelMode = (header >> 6) & 3;
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null;
  }

  const sampleRates = versionBits === 3
    ? [44_100, 48_000, 32_000]
    : versionBits === 2
      ? [22_050, 24_000, 16_000]
      : [11_025, 12_000, 8_000];
  const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sampleRate = sampleRates[sampleRateIndex]!;
  const bitrate = (versionBits === 3 ? mpeg1Bitrates[bitrateIndex] : mpeg2Bitrates[bitrateIndex])! * 1_000;
  const samplesPerFrame = versionBits === 3 ? 1_152 : 576;
  const coefficient = versionBits === 3 ? 144 : 72;
  const frameLength = Math.floor((coefficient * bitrate) / sampleRate) + padding;
  if (frameLength <= 4 || offset + frameLength > data.length + 1) return null;

  return {
    sampleRate,
    channels: channelMode === 3 ? 1 : 2,
    bitrate,
    samplesPerFrame,
    frameLength,
  };
}

function parseOpusHeader(data: Uint8Array): StreamInfo | null {
  // OpusHead starts at offset 28 in Ogg page
  if (data.length < 47) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // OpusHead: "OpusHead" (8) + version(1) + channels(1) + preSkip(2) + sampleRate(4) + gain(2) + mapping(1)
  const channels = view.getUint8(37);
  const sampleRate = view.getUint32(40, true);
  return {
    index: 0, sourceId: 0, kind: 'audio',
    codec: 'Opus', codecFamily: 'unknown',
    codecConfig: null,
    timeBase: { numerator: 1, denominator: 48_000 },
    audio: { sampleRate, channels },
  };
}

export function parseMinimalAudioByFormat(data: Uint8Array, format: string): MediaAnalysisResult {
  let stream: StreamInfo | null = null;

  switch (format) {
    case 'wav': stream = parseWavHeader(data); break;
    case 'flac': stream = parseFlacHeader(data); break;
    case 'mp3': stream = parseMp3Header(data); break;
    case 'opus': stream = parseOpusHeader(data); break;
    default: break;
  }

  return {
    format: { container: 'raw_audio', subtype: format, details: {} },
    streams: stream ? [stream] : [],
    frames: [],
    formatSpecific: {},
    fileSize: data.byteLength,
  };
}

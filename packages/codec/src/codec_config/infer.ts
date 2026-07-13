import type {
  AudioMediaTrack,
  MediaAsset,
  MediaSample,
  VideoMediaTrack,
} from '@media-workflow/core';
import { buildAscFromAdts } from '../aac/asc.js';
import { parseFlvTagAt } from '../flv/tag.js';
import { buildAvcCFromNalus } from '../packet/avcc.js';
import {
  hasAnnexBStartCode,
  splitAnnexBNalus,
  splitLengthPrefixedNalUnits,
} from '../nalu/annexb.js';

export function inferVideoCodecConfig(
  track: VideoMediaTrack,
  samples: MediaSample[],
): Uint8Array | undefined {
  if (track.codecConfig && track.codecConfig.byteLength > 0) {
    return track.codecConfig;
  }
  if (track.codecFamily !== 'h264') return undefined;

  const trackSamples = samples
    .filter(sample => sample.trackId === track.trackId)
    .sort((left, right) => left.ptsUs - right.ptsUs || left.index - right.index);

  for (const sample of trackSamples) {
    const config = extractAvcCFromAccessUnit(sample.data);
    if (config) return config;
  }
  return undefined;
}

export function inferAudioCodecConfig(
  track: AudioMediaTrack,
  asset: MediaAsset,
  samples: MediaSample[],
): Uint8Array | undefined {
  if (track.codecConfig && track.codecConfig.byteLength > 0) {
    return track.codecConfig;
  }
  if (track.codecFamily !== 'aac') return undefined;

  const trackSamples = samples
    .filter(sample => sample.trackId === track.trackId)
    .sort((left, right) => left.ptsUs - right.ptsUs || left.index - right.index);

  for (const sample of trackSamples) {
    if (!sample.data?.byteLength) continue;
    const asc = buildAscFromAdts(sample.data);
    if (asc) return asc;
  }

  if (asset.container.format === 'flv') {
    return scanFlvAacSequenceHeader(asset.source.data);
  }
  return undefined;
}

function extractAvcCFromAccessUnit(data: Uint8Array | undefined): Uint8Array | undefined {
  if (!data?.byteLength) return undefined;

  let nalus = splitLengthPrefixedNalUnits(data, 4);
  if (!nalus && hasAnnexBStartCode(data)) {
    nalus = splitAnnexBNalus(data);
  }
  if (!nalus) return undefined;

  let sps: Uint8Array | undefined;
  let pps: Uint8Array | undefined;
  for (const nalu of nalus) {
    if (nalu.length < 1) continue;
    const nalType = nalu[0]! & 0x1f;
    if (nalType === 7) sps = nalu;
    if (nalType === 8) pps = nalu;
  }
  if (sps && pps) return buildAvcCFromNalus(sps, pps);
  return undefined;
}

function scanFlvAacSequenceHeader(fileBytes: Uint8Array): Uint8Array | undefined {
  if (fileBytes.byteLength < 13) return undefined;
  let offset = 9 + 4;
  while (offset + 11 <= fileBytes.length) {
    const tag = parseFlvTagAt(fileBytes, offset);
    if (!tag || tag.dataSize === 0) break;
    if (tag.tagType === 8 && tag.aacSequenceHeader?.byteLength) {
      return tag.aacSequenceHeader;
    }
    offset += 11 + tag.dataSize + 4;
  }
  return undefined;
}

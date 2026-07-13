import type {
  BitstreamFormat,
  EncodedPacket,
  MediaSample,
  MediaTrack,
} from '@media-workflow/core';
import { resolveAudioBitstreamFormat, resolveVideoBitstreamFormat } from './config.js';

export function sampleToEncodedPacket(
  sample: MediaSample,
  track: MediaTrack,
  containerFormat: string,
): EncodedPacket | null {
  if (!sample.data || sample.data.byteLength === 0) return null;

  const format = containerFormat as Parameters<typeof resolveVideoBitstreamFormat>[0];
  const bitstreamFormat = track.kind === 'video'
    ? resolveVideoBitstreamFormat(format)
    : track.kind === 'audio'
      ? resolveAudioBitstreamFormat(format, track.codecFamily)
      : 'unknown';

  const payload = normalizePacketPayload(sample.data, bitstreamFormat, sample.metadata);

  return {
    packetId: `${sample.sampleId}:packet`,
    sourceSampleId: sample.sampleId,
    trackId: sample.trackId,
    codecFamily: track.codecFamily,
    bitstreamFormat,
    data: payload,
    ptsUs: sample.ptsUs,
    dtsUs: sample.dtsUs,
    durationUs: sample.durationUs,
    isKey: sample.isKey,
    metadata: {
      pictureType: sample.pictureType,
      dataOrigin: sample.metadata.dataOrigin,
    },
  };
}

export function normalizePacketPayload(
  data: Uint8Array,
  bitstreamFormat: BitstreamFormat,
  metadata: Record<string, unknown>,
): Uint8Array {
  if (bitstreamFormat === 'aac_raw') {
    return stripAdtsHeader(data);
  }
  if (bitstreamFormat === 'avcc') {
    return stripFlvAvcWrapper(data, metadata);
  }
  return data;
}

function stripAdtsHeader(data: Uint8Array): Uint8Array {
  if (data.byteLength < 7) return data;
  const protectionAbsent = (data[1]! & 0x01) !== 0;
  const headerLength = protectionAbsent ? 7 : 9;
  if (headerLength >= data.byteLength) return data;
  if ((data[0]! & 0xff) !== 0xff || (data[1]! & 0xf0) !== 0xf0) return data;
  return data.subarray(headerLength);
}

function stripFlvAvcWrapper(
  data: Uint8Array,
  metadata: Record<string, unknown>,
): Uint8Array {
  if (metadata.dataOrigin === 'demuxed_payload') return data;
  if (metadata['flvAvcPacketType'] === 1 && data.byteLength > 4) {
    return data.subarray(4);
  }
  return data;
}

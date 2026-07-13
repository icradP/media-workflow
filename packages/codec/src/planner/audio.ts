import type {
  AudioDecodeRequest,
  AudioMediaTrack,
  EncodedPacket,
  MediaDiagnostic,
  MediaSample,
} from '@media-workflow/core';
import type { DecoderConfig } from '@media-workflow/core';
import { sampleToEncodedPacket } from '../packet/normalize.js';

export function planAudioDecodeRequest(options: {
  requestId: string;
  track: AudioMediaTrack;
  decoderConfig: DecoderConfig;
  samples: MediaSample[];
  rangeStartUs: number;
  rangeEndUs: number;
  containerFormat: string;
}): AudioDecodeRequest {
  const {
    requestId,
    track,
    decoderConfig,
    samples,
    rangeStartUs,
    rangeEndUs,
    containerFormat,
  } = options;

  const diagnostics: MediaDiagnostic[] = [];
  const normalizedStart = Math.max(0, Math.floor(rangeStartUs));
  const normalizedEnd = Math.max(normalizedStart, Math.floor(rangeEndUs));

  if (normalizedEnd <= normalizedStart) {
    diagnostics.push({
      severity: 'warning',
      code: 'audio_request.empty_range',
      message: 'Audio decode range is empty (rangeEndUs must be greater than rangeStartUs).',
      metadata: { rangeStartUs: normalizedStart, rangeEndUs: normalizedEnd },
    });
  }

  const trackSamples = samples
    .filter(sample => sample.trackId === track.trackId)
    .sort((left, right) => left.ptsUs - right.ptsUs || left.index - right.index);

  const overlapping = trackSamples.filter(sample => {
    const sampleStart = sample.ptsUs;
    const sampleEnd = sample.ptsUs + (sample.durationUs ?? 0);
    return sampleEnd > normalizedStart && sampleStart < normalizedEnd;
  });

  const decodePackets = finalizeAudioDecodePackets(
    overlapping
      .map(sample => sampleToEncodedPacket(sample, track, containerFormat))
      .filter((packet): packet is EncodedPacket => packet !== null),
    track,
  );

  if (overlapping.length > 0 && decodePackets.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'audio_request.missing_packet_data',
      message: 'Overlapping audio samples were found but packet bytes are unavailable.',
    });
  }

  return {
    requestId,
    track,
    decoderConfig,
    decodePackets,
    rangeStartUs: normalizedStart,
    rangeEndUs: normalizedEnd,
    diagnostics,
  };
}

function finalizeAudioDecodePackets(
  packets: EncodedPacket[],
  track: AudioMediaTrack,
): EncodedPacket[] {
  if (packets.length === 0) return packets;

  const sorted = [...packets].sort((left, right) =>
    left.ptsUs - right.ptsUs || left.sourceSampleId.localeCompare(right.sourceSampleId),
  );
  const forceKey = track.codecFamily === 'aac';
  const defaultDurationUs = defaultAacFrameDurationUs(
    track.sampleRate ?? track.decoderConfig?.sampleRate,
  );

  return sorted.map((packet, index) => {
    const next = sorted[index + 1];
    const durationUs = packet.durationUs && packet.durationUs > 0
      ? packet.durationUs
      : next && next.ptsUs > packet.ptsUs
        ? next.ptsUs - packet.ptsUs
        : defaultDurationUs;

    return {
      ...packet,
      durationUs,
      isKey: forceKey ? true : packet.isKey,
    };
  });
}

function defaultAacFrameDurationUs(sampleRate?: number): number {
  const rate = sampleRate && sampleRate > 0 ? sampleRate : 48_000;
  return Math.round((1024 / rate) * 1_000_000);
}

export function trimPcmToRange(options: {
  planes: Float32Array[];
  sampleRate: number;
  channels: number;
  ptsUs: number;
  rangeStartUs: number;
  rangeEndUs: number;
}): { planes: Float32Array[]; sampleCount: number; ptsUs: number; durationUs: number } {
  const { planes, sampleRate, channels, ptsUs, rangeStartUs, rangeEndUs } = options;
  const totalSamples = planes[0]?.length ?? 0;
  const clipStartUs = Math.max(rangeStartUs, ptsUs);
  const clipEndUs = Math.min(rangeEndUs, ptsUs + Math.round((totalSamples / sampleRate) * 1_000_000));

  if (clipEndUs <= clipStartUs || totalSamples === 0) {
    return {
      planes: Array.from({ length: channels }, () => new Float32Array(0)),
      sampleCount: 0,
      ptsUs: clipStartUs,
      durationUs: 0,
    };
  }

  const startOffset = Math.max(
    0,
    Math.floor(((clipStartUs - ptsUs) / 1_000_000) * sampleRate),
  );
  const endOffset = Math.min(
    totalSamples,
    Math.ceil(((clipEndUs - ptsUs) / 1_000_000) * sampleRate),
  );
  const sampleCount = Math.max(0, endOffset - startOffset);
  const trimmedPlanes = planes.map(plane => plane.subarray(startOffset, endOffset));
  const durationUs = Math.round((sampleCount / sampleRate) * 1_000_000);

  return {
    planes: trimmedPlanes,
    sampleCount,
    ptsUs: clipStartUs,
    durationUs,
  };
}

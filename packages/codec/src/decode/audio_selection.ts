import type {
  AudioMediaTrack,
  MediaAsset,
  MediaSelection,
  PcmAudioClip,
} from '@media-workflow/core';
import {
  materializeMediaSelection,
  planAudioDecodeRequest,
  selectTrack,
} from '../planner/index.js';
import { decodeMp3SamplesToPcm } from '../audio/mp3_decode.js';

export async function decodeAudioSelectionToPcm(
  selection: MediaSelection,
  requestId: string,
  decodePacket: (request: ReturnType<typeof planAudioDecodeRequest>) => Promise<PcmAudioClip>,
): Promise<PcmAudioClip> {
  const { asset, track } = selection.selectedTrack;
  if (track.kind !== 'audio') {
    throw new Error(`Audio decode: selection track ${track.trackId} is not audio`);
  }

  const rangeEndUs = selection.rangeEndUs ??
    selection.samples.at(-1)?.ptsUs ??
    selection.rangeStartUs;

  if (track.codecFamily === 'mp3') {
    return decodeMp3SamplesToPcm({
      samples: selection.samples,
      rangeStartUs: selection.rangeStartUs,
      rangeEndUs,
      sourceTrackId: track.trackId,
      requestId,
      sampleRate: (track as AudioMediaTrack).sampleRate,
      channels: (track as AudioMediaTrack).channels,
    });
  }

  if (!track.decoderConfig) {
    throw new Error(`Audio decode: track ${track.trackId} has no decoder configuration`);
  }

  const request = planAudioDecodeRequest({
    requestId: `${selection.selectionId}:audio`,
    track: track as AudioMediaTrack,
    decoderConfig: track.decoderConfig,
    samples: asset.samples,
    rangeStartUs: selection.rangeStartUs,
    rangeEndUs,
    containerFormat: asset.container.format,
  });

  return decodePacket(request);
}

export function resolveAudioSelection(
  source: MediaAsset | MediaSelection,
  params: {
    trackId?: string;
    trackIndex?: number;
    startTimeSeconds?: unknown;
    endTimeSeconds?: unknown;
  },
): MediaSelection {
  if (isMediaSelection(source)) return source;

  const selectedTrack = selectTrack(source, {
    trackId: String(params.trackId ?? ''),
    kind: 'audio',
    index: Number(params.trackIndex),
  });
  return materializeMediaSelection(selectedTrack, {
    startTimeUs: secondsToUs(params.startTimeSeconds),
    endTimeUs: secondsToOptionalUs(params.endTimeSeconds),
    frameType: 'all',
    order: 'presentation',
  });
}

function isMediaSelection(value: MediaAsset | MediaSelection): value is MediaSelection {
  return 'selectionId' in value && 'selectedTrack' in value;
}

function secondsToUs(value: unknown): number {
  return Math.max(0, Number(value) || 0) * 1_000_000;
}

function secondsToOptionalUs(value: unknown): number | undefined {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000_000 : undefined;
}

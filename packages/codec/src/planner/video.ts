import type {
  EncodedPacket,
  MediaDiagnostic,
  MediaSample,
  VideoDecodeRequest,
  VideoMediaTrack,
} from '@media-workflow/core';
import type { DecoderConfig } from '@media-workflow/core';
import { sampleToEncodedPacket } from '../packet/normalize.js';

export interface VideoFrameSelection {
  sampleIds?: string[];
  sampleIndexes?: number[];
  ptsUs?: number[];
  frameType?: 'key' | 'all';
  startIndex?: number;
  endIndex?: number;
  startTimeUs?: number;
  endTimeUs?: number;
  limit?: number;
}

export function planVideoDecodeRequest(options: {
  requestId: string;
  track: VideoMediaTrack;
  decoderConfig: DecoderConfig;
  samples: MediaSample[];
  selection: VideoFrameSelection;
  containerFormat: string;
}): VideoDecodeRequest {
  const {
    requestId,
    track,
    decoderConfig,
    samples,
    selection,
    containerFormat,
  } = options;

  const diagnostics: MediaDiagnostic[] = [];
  const trackSamples = samples
    .filter(sample => sample.trackId === track.trackId)
    .sort((left, right) => left.dtsUs - right.dtsUs || left.index - right.index);

  const targetSamples = selectTargetSamples(trackSamples, selection, diagnostics);
  if (targetSamples.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'video_request.empty_targets',
      message: 'No target samples matched the selection criteria.',
    });
  }

  const targetSampleIds = targetSamples.map(sample => sample.sampleId);
  const decodeSamples = collectGopDependencies(trackSamples, targetSamples, diagnostics);
  const decodePackets = decodeSamples
    .map(sample => sampleToEncodedPacket(sample, track, containerFormat))
    .filter((packet): packet is EncodedPacket => packet !== null);

  if (decodePackets.length === 0 && targetSamples.length > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'video_request.missing_packet_data',
      message: 'Target samples were selected but no encoded packet bytes are available.',
    });
  }

  return {
    requestId,
    track,
    decoderConfig,
    decodePackets,
    targetSampleIds,
    diagnostics,
  };
}

function selectTargetSamples(
  trackSamples: MediaSample[],
  selection: VideoFrameSelection,
  diagnostics: MediaDiagnostic[],
): MediaSample[] {
  if (selection.sampleIds && selection.sampleIds.length > 0) {
    const idSet = new Set(selection.sampleIds);
    return trackSamples.filter(sample => idSet.has(sample.sampleId));
  }

  if (selection.sampleIndexes && selection.sampleIndexes.length > 0) {
    const indexSet = new Set(selection.sampleIndexes);
    return trackSamples.filter((_, position) => indexSet.has(position));
  }

  if (selection.ptsUs && selection.ptsUs.length > 0) {
    const ptsSet = new Set(selection.ptsUs);
    return trackSamples.filter(sample => ptsSet.has(sample.ptsUs));
  }

  const firstPtsUs = trackSamples[0]?.ptsUs ?? 0;
  const startIndex = Math.max(0, selection.startIndex ?? 0);
  const endIndex = selection.endIndex !== undefined && selection.endIndex >= 0
    ? selection.endIndex
    : undefined;
  const startTimeUs = selection.startTimeUs ?? 0;
  const endTimeUs = selection.endTimeUs;
  const frameType = selection.frameType ?? 'all';

  let filtered = trackSamples.filter((sample, position) => {
    const relativePtsUs = sample.ptsUs - firstPtsUs;
    const matchesType = frameType === 'all' ||
      (frameType === 'key' && sample.isKey);
    return (
      position >= startIndex &&
      (endIndex === undefined || position <= endIndex) &&
      relativePtsUs >= startTimeUs &&
      (endTimeUs === undefined || relativePtsUs <= endTimeUs) &&
      matchesType
    );
  });

  if (selection.limit !== undefined && selection.limit >= 0) {
    filtered = filtered.slice(0, selection.limit);
  }

  if (filtered.length === 0) {
    diagnostics.push({
      severity: 'info',
      code: 'video_request.no_matches',
      message: 'Selection filters produced zero target samples.',
    });
  }

  return filtered;
}

function collectGopDependencies(
  trackSamples: MediaSample[],
  targetSamples: MediaSample[],
  diagnostics: MediaDiagnostic[],
): MediaSample[] {
  if (targetSamples.length === 0) return [];

  const selected = new Map<string, MediaSample>();
  for (const target of targetSamples) {
    const targetPosition = trackSamples.findIndex(sample => sample.sampleId === target.sampleId);
    if (targetPosition < 0) continue;

    let keyPosition = -1;
    for (let index = targetPosition; index >= 0; index--) {
      if (trackSamples[index]!.isKey) {
        keyPosition = index;
        break;
      }
    }

    if (keyPosition < 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'video_request.no_preceding_keyframe',
        message: `Sample ${target.sampleId} has no preceding key frame in this track.`,
        metadata: { sampleId: target.sampleId },
      });
      keyPosition = 0;
    }

    for (let index = keyPosition; index <= targetPosition; index++) {
      const sample = trackSamples[index]!;
      selected.set(sample.sampleId, sample);
    }
  }

  return [...selected.values()].sort((left, right) =>
    left.dtsUs - right.dtsUs || left.index - right.index,
  );
}

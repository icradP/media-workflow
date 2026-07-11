import type {
  MediaAsset,
  MediaSample,
  MediaTrack,
  NodeDefinition,
} from '@media-workflow/core';

type FrameFilter = 'all' | 'key' | 'non_key' | 'I' | 'P' | 'B' | 'IDR';

/**
 * Select samples belonging to one track.
 *
 * Index ranges are inclusive and relative to the selected track, not the
 * asset-wide sample index. Time ranges are seconds relative to the first
 * sample PTS of that track. A negative end value means no upper bound.
 */
export const frameSelectorNode: NodeDefinition<
  { asset: 'media_asset'; track: 'media_track' },
  { samples: 'media_samples' }
> = {
  id: 'frame_selector',
  category: 'utility',
  displayName: 'Frame Selector',
  description: 'Select a track frame range and optionally filter frame type.',
  inputs: {
    asset: { type: 'media_asset', label: 'Media Asset' },
    track: { type: 'media_track', label: 'Media Track' },
  },
  outputs: {
    samples: { type: 'media_samples', label: 'Selected Frames' },
  },
  params: {
    startIndex: { name: 'startIndex', type: 'number', default: 0, min: 0, step: 1 },
    endIndex: { name: 'endIndex', type: 'number', default: -1, min: -1, step: 1 },
    startTimeSeconds: {
      name: 'startTimeSeconds',
      type: 'number',
      default: 0,
      min: 0,
      step: 0.1,
    },
    endTimeSeconds: {
      name: 'endTimeSeconds',
      type: 'number',
      default: -1,
      min: -1,
      step: 0.1,
    },
    frameType: {
      name: 'frameType',
      type: 'enum',
      default: 'all',
      values: ['all', 'key', 'non_key', 'I', 'P', 'B', 'IDR'],
    },
    limit: { name: 'limit', type: 'number', default: -1, min: -1, step: 1 },
  },
  async execute(ctx, { inputs, params }) {
    const asset = inputs.asset as MediaAsset | undefined;
    const track = inputs.track as MediaTrack | undefined;
    if (!asset) throw new Error('FrameSelector: no media asset');
    if (!track) throw new Error('FrameSelector: no selected track');
    if (!asset.tracks.some(candidate => candidate.trackId === track.trackId)) {
      throw new Error(`FrameSelector: track ${track.trackId} does not belong to this asset`);
    }

    const trackSamples = asset.samples
      .filter(sample => sample.trackId === track.trackId)
      .sort((left, right) => left.index - right.index);
    const firstPtsUs = trackSamples[0]?.ptsUs ?? 0;
    const startIndex = nonNegativeInteger(params.startIndex, 0);
    const endIndex = optionalUpperBound(params.endIndex);
    const startTimeUs = nonNegativeNumber(params.startTimeSeconds, 0) * 1_000_000;
    const endTimeSeconds = Number(params.endTimeSeconds);
    const endTimeUs = Number.isFinite(endTimeSeconds) && endTimeSeconds >= 0
      ? endTimeSeconds * 1_000_000
      : undefined;
    const frameType = normalizeFrameFilter(params.frameType);
    const limit = optionalUpperBound(params.limit);

    const filtered = trackSamples.filter((sample, position) => {
      const relativePtsUs = sample.ptsUs - firstPtsUs;
      return (
        position >= startIndex &&
        (endIndex === undefined || position <= endIndex) &&
        relativePtsUs >= startTimeUs &&
        (endTimeUs === undefined || relativePtsUs <= endTimeUs) &&
        matchesFrameType(sample, frameType)
      );
    });
    const samples = limit === undefined ? filtered : filtered.slice(0, limit);

    ctx.log.info(
      `FrameSelector: ${samples.length}/${trackSamples.length} samples from ${track.trackId}`,
    );
    return { samples };
  },
};

function matchesFrameType(sample: MediaSample, filter: FrameFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'key') return sample.isKey;
  if (filter === 'non_key') return !sample.isKey;
  if (filter === 'IDR') {
    return sample.pictureType?.toUpperCase() === 'IDR' || sample.metadata.isIdr === true;
  }
  return sample.pictureType?.toUpperCase() === filter;
}

function normalizeFrameFilter(value: unknown): FrameFilter {
  const normalized = String(value ?? 'all');
  return ['all', 'key', 'non_key', 'I', 'P', 'B', 'IDR'].includes(normalized)
    ? normalized as FrameFilter
    : 'all';
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function optionalUpperBound(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}

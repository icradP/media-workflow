import type {
  MediaAsset,
  MediaDiagnostic,
  MediaFrameFilter,
  MediaSample,
  MediaSelection,
  MediaSelectionCriteria,
  MediaTrack,
  SelectedTrack,
} from '@media-workflow/core';

export interface TrackSelectionOptions {
  trackId?: string;
  kind?: 'any' | MediaTrack['kind'];
  index?: number;
}

export interface MediaSelectionOptions {
  startIndex?: number;
  endIndex?: number;
  startTimeUs?: number;
  endTimeUs?: number;
  frameType?: MediaFrameFilter;
  limit?: number;
  order?: MediaSelectionCriteria['order'];
}

export function selectTrack(
  asset: MediaAsset,
  options: TrackSelectionOptions = {},
): SelectedTrack {
  const trackId = options.trackId?.trim() ?? '';
  const kind = options.kind ?? 'any';
  const index = Math.max(0, Math.floor(options.index ?? 0));
  const candidates = kind === 'any'
    ? asset.tracks
    : asset.tracks.filter(track => track.kind === kind);
  const track = trackId
    ? asset.tracks.find(candidate => candidate.trackId === trackId)
    : candidates[index];

  if (!track) {
    throw new Error(
      `No track matched trackId="${trackId}", kind="${kind}", index=${index}.`,
    );
  }

  const samples = asset.samples
    .filter(sample => sample.trackId === track.trackId)
    .sort(comparePresentationOrder);

  return {
    selectedTrackId: [
      asset.source.sourceId,
      asset.source.version,
      track.trackId,
    ].join(':'),
    asset,
    track,
    samples,
    diagnostics: [],
  };
}

export function materializeMediaSelection(
  selectedTrack: SelectedTrack,
  options: MediaSelectionOptions = {},
): MediaSelection {
  const criteria = normalizeCriteria(options);
  const presentationSamples = [...selectedTrack.samples].sort(comparePresentationOrder);
  const firstPtsUs = presentationSamples[0]?.ptsUs ?? 0;
  const absoluteStartUs = firstPtsUs + criteria.startTimeUs;
  const absoluteEndUs = criteria.endTimeUs === undefined
    ? undefined
    : firstPtsUs + criteria.endTimeUs;
  const diagnostics: MediaDiagnostic[] = [...selectedTrack.diagnostics];

  let samples = presentationSamples.filter((sample, position) => {
    if (position < criteria.startIndex) return false;
    if (criteria.endIndex !== undefined && position > criteria.endIndex) return false;
    if (!matchesFrameType(sample, criteria.frameType)) return false;

    if (selectedTrack.track.kind === 'audio') {
      const nextPtsUs = presentationSamples[position + 1]?.ptsUs;
      const sampleEndUs = sample.durationUs && sample.durationUs > 0
        ? sample.ptsUs + sample.durationUs
        : Math.max(sample.ptsUs + 1, nextPtsUs ?? sample.ptsUs + 1);
      return sampleEndUs > absoluteStartUs &&
        (absoluteEndUs === undefined || sample.ptsUs < absoluteEndUs);
    }

    return sample.ptsUs >= absoluteStartUs &&
      (absoluteEndUs === undefined || sample.ptsUs < absoluteEndUs);
  });

  if (criteria.order === 'decode') {
    samples = samples.sort(compareDecodeOrder);
  }
  if (criteria.limit !== undefined) {
    samples = samples.slice(0, criteria.limit);
  }

  if (samples.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'selection.empty',
      message: 'No media samples matched the selection.',
    });
  }

  const rangeEndUs = absoluteEndUs ?? inferTrackEndUs(presentationSamples);
  const selectionId = stableSelectionId({
    sourceId: selectedTrack.asset.source.sourceId,
    sourceVersion: selectedTrack.asset.source.version,
    trackId: selectedTrack.track.trackId,
    criteria,
    sampleIds: samples.map(sample => sample.sampleId),
  });

  return {
    selectionId,
    selectedTrack,
    samples,
    rangeStartUs: absoluteStartUs,
    rangeEndUs,
    criteria,
    diagnostics,
  };
}

export function stableSelectionId(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `selection:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeCriteria(options: MediaSelectionOptions): MediaSelectionCriteria {
  const startIndex = nonNegativeInteger(options.startIndex, 0);
  const endIndex = optionalNonNegativeInteger(options.endIndex);
  const startTimeUs = nonNegativeNumber(options.startTimeUs, 0);
  const endTimeUs = optionalNonNegativeNumber(options.endTimeUs);
  const limit = optionalNonNegativeInteger(options.limit);
  const frameType = normalizeFrameFilter(options.frameType);

  return {
    startIndex,
    endIndex,
    startTimeUs,
    endTimeUs,
    frameType,
    limit,
    order: options.order === 'decode' ? 'decode' : 'presentation',
  };
}

function matchesFrameType(sample: MediaSample, filter: MediaFrameFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'key') return sample.isKey;
  if (filter === 'non_key') return !sample.isKey;
  if (filter === 'IDR') {
    return sample.pictureType?.toUpperCase() === 'IDR' || sample.metadata.isIdr === true;
  }
  return sample.pictureType?.toUpperCase() === filter;
}

function normalizeFrameFilter(value: unknown): MediaFrameFilter {
  const normalized = String(value ?? 'all');
  return ['all', 'key', 'non_key', 'I', 'P', 'B', 'IDR'].includes(normalized)
    ? normalized as MediaFrameFilter
    : 'all';
}

function comparePresentationOrder(left: MediaSample, right: MediaSample): number {
  return left.index - right.index || left.ptsUs - right.ptsUs;
}

function compareDecodeOrder(left: MediaSample, right: MediaSample): number {
  return left.dtsUs - right.dtsUs || left.index - right.index;
}

function inferTrackEndUs(samples: MediaSample[]): number | undefined {
  const last = samples[samples.length - 1];
  return last ? last.ptsUs + Math.max(0, last.durationUs ?? 0) : undefined;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

import type {
  MediaAsset,
  NodeDefinition,
  SelectedTrack,
} from '@media-workflow/core';
import {
  materializeMediaSelection,
  selectTrack,
} from '@media-workflow/codec';

export const mediaSelectNode: NodeDefinition<
  { source: 'selection_source' },
  { selection: 'media_selection' }
> = {
  id: 'media_select',
  category: 'select',
  displayName: 'Media Select',
  description: 'Select a track range once for inspection, decode, or export.',
  inputs: {
    source: { type: 'selection_source', label: 'Asset or Selected Track' },
  },
  outputs: {
    selection: { type: 'media_selection', label: 'Media Selection' },
  },
  params: {
    trackId: { name: 'trackId', type: 'string', default: '' },
    kind: {
      name: 'kind',
      type: 'enum',
      default: 'any',
      values: ['any', 'video', 'audio', 'data'],
    },
    trackIndex: { name: 'trackIndex', type: 'number', default: 0, min: 0, step: 1 },
    startIndex: { name: 'startIndex', type: 'number', default: 0, min: 0, step: 1 },
    endIndex: { name: 'endIndex', type: 'number', default: -1, min: -1, step: 1 },
    startTimeSeconds: {
      name: 'startTimeSeconds',
      type: 'number',
      default: 0,
      min: 0,
      step: 0.001,
    },
    endTimeSeconds: {
      name: 'endTimeSeconds',
      type: 'number',
      default: -1,
      min: -1,
      step: 0.001,
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
    const source = inputs.source as MediaAsset | SelectedTrack | undefined;
    if (!source) throw new Error('MediaSelect: asset or selected track is required');

    const selectedTrack = isSelectedTrack(source)
      ? source
      : selectTrack(source, {
        trackId: String(params.trackId ?? ''),
        kind: normalizeKind(params.kind),
        index: Number(params.trackIndex),
      });

    const endIndex = optionalUpperBound(params.endIndex);
    const endTimeSeconds = optionalUpperBound(params.endTimeSeconds);
    const limit = optionalUpperBound(params.limit);
    const selection = materializeMediaSelection(selectedTrack, {
      startIndex: Number(params.startIndex),
      endIndex,
      startTimeUs: Math.max(0, Number(params.startTimeSeconds) || 0) * 1_000_000,
      endTimeUs: endTimeSeconds === undefined
        ? undefined
        : endTimeSeconds * 1_000_000,
      frameType: String(params.frameType) as never,
      limit,
      order: 'presentation',
    });

    ctx.log.info(
      `MediaSelect: ${selection.samples.length}/${selectedTrack.samples.length} sample(s) from ${selectedTrack.track.trackId}`,
    );
    return { selection };
  },
};

function isSelectedTrack(value: MediaAsset | SelectedTrack): value is SelectedTrack {
  return 'asset' in value && 'track' in value && 'samples' in value;
}

function normalizeKind(value: unknown): 'any' | 'video' | 'audio' | 'data' {
  const kind = String(value ?? 'any');
  return ['video', 'audio', 'data'].includes(kind)
    ? kind as 'video' | 'audio' | 'data'
    : 'any';
}

function optionalUpperBound(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

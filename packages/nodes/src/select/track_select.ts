import type { MediaAsset, NodeDefinition } from '@media-workflow/core';
import { selectTrack } from '@media-workflow/codec';

export const trackSelectNode: NodeDefinition<
  { asset: 'media_asset' },
  { selectedTrack: 'selected_track' }
> = {
  id: 'track_select',
  category: 'select',
  displayName: 'Track Select',
  description: 'Bind one media track to its asset and ordered samples.',
  inputs: {
    asset: { type: 'media_asset', label: 'Media Asset' },
  },
  outputs: {
    selectedTrack: { type: 'selected_track', label: 'Selected Track' },
  },
  params: {
    trackId: { name: 'trackId', type: 'string', default: '' },
    kind: {
      name: 'kind',
      type: 'enum',
      default: 'any',
      values: ['any', 'video', 'audio', 'data'],
    },
    index: { name: 'index', type: 'number', default: 0, min: 0, step: 1 },
  },
  async execute(ctx, { inputs, params }) {
    const asset = inputs.asset as MediaAsset | undefined;
    if (!asset) throw new Error('TrackSelect: media asset is required');

    const selectedTrack = selectTrack(asset, {
      trackId: String(params.trackId ?? ''),
      kind: normalizeKind(params.kind),
      index: Number(params.index),
    });
    ctx.log.info(`TrackSelect: ${selectedTrack.track.trackId}`);
    return { selectedTrack };
  },
};

function normalizeKind(value: unknown): 'any' | 'video' | 'audio' | 'data' {
  const kind = String(value ?? 'any');
  return ['video', 'audio', 'data'].includes(kind)
    ? kind as 'video' | 'audio' | 'data'
    : 'any';
}

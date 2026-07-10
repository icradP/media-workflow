import type { MediaAsset, NodeDefinition } from '@media-workflow/core';

export const trackSelectorNode: NodeDefinition<
  { asset: 'media_asset' },
  { track: 'media_track' }
> = {
  id: 'track_selector',
  category: 'utility',
  displayName: 'Track Selector',
  description: 'Select one track by ID, kind, and zero-based position.',
  inputs: {
    asset: { type: 'media_asset', label: 'Media Asset' },
  },
  outputs: {
    track: { type: 'media_track', label: 'Selected Track' },
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
    if (!asset) throw new Error('TrackSelector: no media asset');

    const trackId = String(params.trackId ?? '').trim();
    const kind = String(params.kind ?? 'any');
    const index = Math.max(0, Math.floor(Number(params.index) || 0));
    const candidates = kind === 'any'
      ? asset.tracks
      : asset.tracks.filter(track => track.kind === kind);
    const track = trackId
      ? asset.tracks.find(candidate => candidate.trackId === trackId)
      : candidates[index];

    if (!track) {
      throw new Error(
        `TrackSelector: no track matched trackId="${trackId}", kind="${kind}", index=${index}`,
      );
    }

    ctx.log.info(`TrackSelector: ${track.trackId}`);
    return { track };
  },
};

import type { NodeDefinition } from '@media-workflow/core';
import type { MediaAsset } from '@media-workflow/core';

/**
 * Stream Overview — exposes every normalized track for rendering and branching.
 *
 * Inputs:  asset
 * Outputs: tracks
 */
export const streamOverviewNode: NodeDefinition<
  { asset: 'media_asset' },
  { tracks: 'track_list' }
> = {
  id: 'stream_overview',
  category: 'display',
  displayName: 'Stream Overview',
  description: 'Display the container summary and every parsed media track.',
  inputs: {
    asset: { type: 'media_asset', label: 'Media Asset' },
  },
  outputs: {
    tracks: { type: 'track_list', label: 'Tracks' },
  },
  async execute(ctx, { inputs }) {
    const asset = inputs.asset as MediaAsset | undefined;
    if (!asset) throw new Error('StreamOverview: no media asset');
    ctx.log.info(`StreamOverview: ${asset.tracks.length} tracks`);
    return { tracks: asset.tracks };
  },
};

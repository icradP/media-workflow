import type { MediaTrack, NodeDefinition } from '@media-workflow/core';

export const trackDetailNode: NodeDefinition<
  { track: 'media_track' },
  Record<string, never>
> = {
  id: 'track_detail',
  category: 'display',
  displayName: 'Track Detail',
  description: 'Display normalized metadata for one selected media track.',
  inputs: {
    track: { type: 'media_track', label: 'Media Track' },
  },
  outputs: {},
  async execute(ctx, { inputs }) {
    const track = inputs.track as MediaTrack | undefined;
    if (!track) throw new Error('TrackDetail: no media track');
    ctx.log.info(`TrackDetail: ${track.trackId} ${track.codec}`);
    return {};
  },
};

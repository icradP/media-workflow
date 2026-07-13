import type { NodeDefinition, SelectedTrack } from '@media-workflow/core';

export const trackDetailNode: NodeDefinition<
  { selectedTrack: 'selected_track' },
  Record<string, never>
> = {
  id: 'track_detail',
  category: 'inspect',
  displayName: 'Track Detail',
  description: 'Display normalized metadata for one selected media track.',
  inputs: {
    selectedTrack: { type: 'selected_track', label: 'Selected Track' },
  },
  outputs: {},
  async execute(ctx, { inputs }) {
    const selectedTrack = inputs.selectedTrack as SelectedTrack | undefined;
    if (!selectedTrack) throw new Error('TrackDetail: selected track is required');
    const track = selectedTrack.track;
    ctx.log.info(`TrackDetail: ${track.trackId} ${track.codec}`);
    return {};
  },
};

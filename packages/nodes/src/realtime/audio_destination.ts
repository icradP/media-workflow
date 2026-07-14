import type { NodeDefinition } from '@media-workflow/core';
import { createWebAudioHandle, requireWebAudio } from './handles.js';

export const audioDestinationNode: NodeDefinition<
  { in: 'webaudio' },
  { status: 'string' }
> = {
  id: 'audio_destination',
  category: 'realtime',
  displayName: 'Audio Destination',
  description: 'Web Audio destination (speakers) for Live playback.',
  inputs: {
    in: { type: 'webaudio', label: 'In' },
  },
  outputs: {
    status: { type: 'string', label: 'Status' },
  },
  cachePolicy: 'never',
  async execute(ctx, { inputs }) {
    requireWebAudio(inputs.in, 'AudioDestination');
    const handle = createWebAudioHandle('destination', 'audio_destination', {});
    ctx.log.info('AudioDestination: wired (Live Play to hear audio)');
    return {
      status: JSON.stringify({ mode: 'live-only', kind: handle.kind }),
    };
  },
};

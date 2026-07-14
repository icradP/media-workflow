import type { NodeDefinition } from '@media-workflow/core';
import { createWebAudioHandle, requireWebAudio } from './handles.js';

export const audioGainNode: NodeDefinition<
  { in: 'webaudio'; gain: 'number' },
  { out: 'webaudio' }
> = {
  id: 'audio_gain',
  category: 'realtime',
  displayName: 'Audio Gain',
  description: 'Web Audio GainNode for Live playback.',
  inputs: {
    in: { type: 'webaudio', label: 'In' },
    gain: { type: 'number', label: 'Gain', optional: true },
  },
  outputs: {
    out: { type: 'webaudio', label: 'Out' },
  },
  params: {
    gain: { name: 'gain', type: 'number', default: 1, min: 0, max: 4, step: 0.01 },
  },
  cachePolicy: 'never',
  async execute(ctx, { inputs, params }) {
    const upstream = requireWebAudio(inputs.in, 'AudioGain');
    const gain = inputs.gain !== undefined ? Number(inputs.gain) : Number(params.gain) || 1;
    const handle = createWebAudioHandle('gain', 'audio_gain', { gain }, { upstream });
    ctx.log.info(`AudioGain: ${gain}`);
    return { out: handle };
  },
};

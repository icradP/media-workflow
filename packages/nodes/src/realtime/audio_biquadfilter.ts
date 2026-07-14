import type { NodeDefinition } from '@media-workflow/core';
import { createWebAudioHandle, requireWebAudio } from './handles.js';

const FILTER_TYPES = [
  'lowpass',
  'highpass',
  'bandpass',
  'lowshelf',
  'highshelf',
  'peaking',
  'notch',
  'allpass',
];

export const audioBiquadFilterNode: NodeDefinition<
  { in: 'webaudio'; frequency: 'number' },
  { out: 'webaudio' }
> = {
  id: 'audio_biquadfilter',
  category: 'realtime',
  displayName: 'Audio Biquad Filter',
  description: 'Web Audio BiquadFilterNode for Live playback.',
  inputs: {
    in: { type: 'webaudio', label: 'In' },
    frequency: { type: 'number', label: 'Frequency', optional: true },
  },
  outputs: {
    out: { type: 'webaudio', label: 'Out' },
  },
  params: {
    type: {
      name: 'type',
      type: 'enum',
      default: 'lowpass',
      values: FILTER_TYPES,
    },
    frequency: {
      name: 'frequency',
      type: 'number',
      default: 350,
      min: 10,
      max: 24_000,
      step: 1,
    },
    Q: { name: 'Q', type: 'number', default: 1, min: 0.0001, max: 1000, step: 0.01 },
    detune: { name: 'detune', type: 'number', default: 0, min: -1200, max: 1200, step: 1 },
  },
  cachePolicy: 'never',
  async execute(ctx, { inputs, params }) {
    const upstream = requireWebAudio(inputs.in, 'AudioBiquadFilter');
    const frequency = inputs.frequency !== undefined
      ? Number(inputs.frequency)
      : Number(params.frequency) || 350;
    const handle = createWebAudioHandle('biquadfilter', 'audio_biquadfilter', {
      type: String(params.type ?? 'lowpass'),
      frequency,
      Q: Number(params.Q) || 1,
      detune: Number(params.detune) || 0,
    }, { upstream });
    ctx.log.info(`AudioBiquadFilter: ${handle.params.type} @ ${frequency} Hz`);
    return { out: handle };
  },
};

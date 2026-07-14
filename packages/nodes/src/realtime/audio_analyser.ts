import type { AudioSpectrum, NodeDefinition } from '@media-workflow/core';
import { createWebAudioHandle, requireWebAudio } from './handles.js';

export const audioAnalyserNode: NodeDefinition<
  { in: 'webaudio' },
  { spectrum: 'audio_spectrum' }
> = {
  id: 'audio_analyser',
  category: 'realtime',
  displayName: 'Audio Analyser',
  description: 'Web Audio AnalyserNode; spectrum is sampled during Live Play.',
  inputs: {
    in: { type: 'webaudio', label: 'In' },
  },
  outputs: {
    spectrum: { type: 'audio_spectrum', label: 'Spectrum' },
  },
  params: {
    fftSize: {
      name: 'fftSize',
      type: 'enum',
      default: '2048',
      values: ['256', '512', '1024', '2048', '4096', '8192'],
    },
    minDecibels: {
      name: 'minDecibels',
      type: 'number',
      default: -100,
      min: -200,
      max: 0,
      step: 1,
    },
    maxDecibels: {
      name: 'maxDecibels',
      type: 'number',
      default: -10,
      min: -100,
      max: 0,
      step: 1,
    },
    smoothingTimeConstant: {
      name: 'smoothingTimeConstant',
      type: 'number',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
  },
  cachePolicy: 'never',
  async execute(ctx, { inputs, params }) {
    requireWebAudio(inputs.in, 'AudioAnalyser');
    const fftSize = Number(params.fftSize) || 2048;
    createWebAudioHandle('analyser', 'audio_analyser', {
      fftSize,
      minDecibels: Number(params.minDecibels) || -100,
      maxDecibels: Number(params.maxDecibels) || -10,
      smoothingTimeConstant: Number(params.smoothingTimeConstant) || 0.5,
    });
    const spectrum: AudioSpectrum = {
      bins: new Uint8Array(fftSize / 2),
      sampleRate: 48_000,
      fftSize,
    };
    ctx.log.info(`AudioAnalyser: fftSize=${fftSize} (Live Play samples spectrum)`);
    return { spectrum };
  },
};

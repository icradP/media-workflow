import type { AudioSpectrum, NodeDefinition } from '@media-workflow/core';

export const audioVisualizationNode: NodeDefinition<
  { spectrum: 'audio_spectrum'; mark: 'number' },
  { preview: 'string' }
> = {
  id: 'audio_visualization',
  category: 'realtime',
  displayName: 'Audio Visualization',
  description: 'Draw Live analyser frequency data (updated during Live Play).',
  inputs: {
    spectrum: { type: 'audio_spectrum', label: 'Spectrum' },
    mark: { type: 'number', label: 'Mark Hz', optional: true },
  },
  outputs: {
    preview: { type: 'string', label: 'Preview Meta' },
  },
  params: {
    continuous: { name: 'continuous', type: 'boolean', default: true },
    mark: {
      name: 'mark',
      type: 'number',
      default: -1,
      min: -1,
      max: 24_000,
      step: 1,
    },
  },
  cachePolicy: 'never',
  async execute(ctx, { inputs, params }) {
    const spectrum = inputs.spectrum as AudioSpectrum | undefined;
    if (!spectrum) {
      throw new Error('AudioVisualization: spectrum input is required');
    }
    const mark = inputs.mark !== undefined ? Number(inputs.mark) : Number(params.mark);
    ctx.log.info(
      `AudioVisualization: ${spectrum.bins.length} bins · mark=${mark} (Live Play draws)`,
    );
    return {
      preview: JSON.stringify({
        mode: 'live-only',
        binCount: spectrum.bins.length,
        sampleRate: spectrum.sampleRate,
        fftSize: spectrum.fftSize,
        continuous: Boolean(params.continuous),
        mark: Number.isFinite(mark) ? mark : -1,
      }),
    };
  },
};

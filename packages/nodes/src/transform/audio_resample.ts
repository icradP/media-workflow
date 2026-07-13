import type { NodeDefinition, PcmAudioClip } from '@media-workflow/core';
import { resamplePcmClip } from '@media-workflow/codec';

const COMMON_SAMPLE_RATES = [8_000, 11_025, 16_000, 22_050, 32_000, 44_100, 48_000];

export const audioResampleNode: NodeDefinition<
  { pcm: 'pcm_audio' },
  { pcm: 'pcm_audio' }
> = {
  id: 'audio_resample',
  category: 'transform',
  displayName: 'Audio Resample',
  description: 'Resample planar Float32 PCM to a target sample rate.',
  inputs: {
    pcm: { type: 'pcm_audio', label: 'PCM Audio Clip' },
  },
  outputs: {
    pcm: { type: 'pcm_audio', label: 'Resampled PCM' },
  },
  params: {
    sampleRate: {
      name: 'sampleRate',
      type: 'enum',
      default: '48000',
      values: COMMON_SAMPLE_RATES.map(String),
    },
  },
  async execute(ctx, { inputs, params }) {
    const pcm = inputs.pcm as PcmAudioClip | undefined;
    if (!pcm) throw new Error('AudioResample: PCM clip is required');

    const sampleRate = Number(params.sampleRate);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error(`AudioResample: invalid sample rate ${String(params.sampleRate)}`);
    }

    const resampled = resamplePcmClip(pcm, { sampleRate });
    ctx.log.info(
      `AudioResample: ${pcm.sampleRate} Hz → ${resampled.sampleRate} Hz · `
      + `${pcm.sampleCount} → ${resampled.sampleCount} sample(s)`,
    );
    return { pcm: resampled };
  },
};

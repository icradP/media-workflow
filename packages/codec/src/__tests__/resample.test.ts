import { describe, expect, it } from 'vitest';
import type { PcmAudioClip } from '@media-workflow/core';
import { WEBCODECS_AAC_BACKEND } from '@media-workflow/core/decoder';
import { resamplePcmClip } from '../decode/resample.js';

function makeClip(sampleRate: number, samples: number[]): PcmAudioClip {
  return {
    clipId: 'test:pcm',
    sourceTrackId: 'track:0',
    ptsUs: 0,
    durationUs: Math.round((samples.length / sampleRate) * 1_000_000),
    sampleRate,
    channels: 1,
    sampleCount: samples.length,
    format: 'f32-planar',
    planes: [new Float32Array(samples)],
    backend: WEBCODECS_AAC_BACKEND,
    diagnostics: [],
  };
}

describe('resamplePcmClip', () => {
  it('returns the same clip when sample rate is unchanged', () => {
    const clip = makeClip(48_000, [0, 0.5, 1]);
    expect(resamplePcmClip(clip, { sampleRate: 48_000 })).toBe(clip);
  });

  it('upsamples PCM to the target rate', () => {
    const clip = makeClip(8_000, [0, 1]);
    const resampled = resamplePcmClip(clip, { sampleRate: 16_000 });
    expect(resampled.sampleRate).toBe(16_000);
    expect(resampled.sampleCount).toBe(4);
    expect(resampled.planes[0]).toHaveLength(4);
    expect(resampled.durationUs).toBe(clip.durationUs);
  });

  it('downsamples PCM to the target rate', () => {
    const clip = makeClip(48_000, [0, 0.25, 0.5, 0.75, 1]);
    const resampled = resamplePcmClip(clip, { sampleRate: 24_000 });
    expect(resampled.sampleRate).toBe(24_000);
    expect(resampled.sampleCount).toBe(3);
    expect(resampled.planes[0]).toHaveLength(3);
  });
});

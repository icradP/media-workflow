import { describe, expect, it } from 'vitest';
import type { PcmAudioClip } from '@media-workflow/core';
import { encodeWav } from '@media-workflow/codec';

describe('wav encoder', () => {
  const clip: PcmAudioClip = {
    clipId: 'clip-1',
    sourceTrackId: 'mp4:audio:1',
    ptsUs: 0,
    durationUs: 100_000,
    sampleRate: 8_000,
    channels: 1,
    sampleCount: 2,
    format: 'f32-planar',
    planes: [new Float32Array([0, 0.5])],
    backend: {
      id: 'test',
      version: '1',
      api: 'software',
      codecFamilies: ['pcm'],
      inputFormats: [],
      outputFormats: ['f32-planar'],
    },
    diagnostics: [],
  };

  it('encodes PCM16 WAV with RIFF header', () => {
    const wav = encodeWav(clip, 'pcm16');
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE');
    expect(wav.byteLength).toBe(44 + 2 * clip.sampleCount * clip.channels);
  });

  it('encodes Float32 WAV', () => {
    const wav = encodeWav(clip, 'float32');
    expect(wav.byteLength).toBe(44 + 4 * clip.sampleCount * clip.channels);
  });
});

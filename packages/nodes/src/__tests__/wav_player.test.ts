import { describe, expect, it } from 'vitest';
import { createContext, type MediaSource } from '@media-workflow/core';
import { encodeWav } from '@media-workflow/codec';
import { normalizeWavInput, wavPlayerNode } from '../display/wav_player.js';

const pcmClip = {
  clipId: 'clip-1',
  sourceTrackId: 'audio:0',
  ptsUs: 0,
  durationUs: 1_000_000,
  sampleRate: 48_000,
  channels: 2,
  sampleCount: 4,
  format: 'f32-planar' as const,
  planes: [
    new Float32Array([0, 0.25, -0.25, 0.5]),
    new Float32Array([0, -0.25, 0.25, -0.5]),
  ],
  backend: {
    id: 'mock',
    version: '1',
    api: 'mock' as const,
    codecFamilies: ['pcm' as const],
    inputFormats: ['unknown' as const],
    outputFormats: ['f32-planar' as const],
  },
  diagnostics: [],
};

describe('WAV Player', () => {
  it('plays encoded WAV media files', async () => {
    const wav = encodeWav(pcmClip, 'pcm16');
    const result = await wavPlayerNode.execute(
      createContext(new AbortController().signal),
      {
        inputs: {
          source: {
            fileName: 'audio.wav',
            mimeType: 'audio/wav',
            extension: 'wav',
            data: wav,
            metadata: {},
          },
        },
        params: { autoplay: false },
      },
    );

    const preview = JSON.parse(result.preview);
    expect(preview).toMatchObject({
      fileName: 'audio.wav',
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
      byteLength: wav.byteLength,
    });
  });

  it('accepts loaded WAV media sources', () => {
    const wav = encodeWav(pcmClip, 'pcm16');
    const source: MediaSource = {
      sourceId: 'fixture:wav',
      version: '1',
      kind: 'file',
      name: 'music.wav',
      size: wav.byteLength,
      data: wav,
      metadata: {},
    };

    const file = normalizeWavInput(source);
    expect(file.fileName).toBe('music.wav');
    expect(file.data).toEqual(wav);
  });

  it('rejects non-WAV bytes', () => {
    expect(() => normalizeWavInput({
      fileName: 'bad.wav',
      mimeType: 'audio/wav',
      extension: 'wav',
      data: Uint8Array.of(0, 1, 2, 3),
      metadata: {},
    })).toThrow('WAV RIFF header');
  });
});

import { describe, expect, it, afterEach } from 'vitest';
import type { PcmAudioClip } from '@media-workflow/core';
import {
  audioBufferToPcmClip,
  isAudioContextAvailable,
  pcmClipToOfflineAudioBuffer,
  renderPcmThroughWebAudioChain,
  resetSharedAudioContextForTests,
} from '../audio/audio_context_manager.js';

function makeClip(sampleRate: number, channels: number, sampleCount: number): PcmAudioClip {
  const planes = Array.from({ length: channels }, (_, channel) => {
    const plane = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      plane[i] = Math.sin((2 * Math.PI * (440 + channel * 10) * i) / sampleRate) * 0.2;
    }
    return plane;
  });
  return {
    clipId: 'test',
    sourceTrackId: 'a0',
    ptsUs: 0,
    durationUs: Math.round((sampleCount / sampleRate) * 1_000_000),
    sampleRate,
    channels,
    sampleCount,
    format: 'f32-planar',
    planes,
    backend: {
      id: 'test',
      version: '0',
      api: 'mock',
      codecFamilies: [],
      inputFormats: [],
      outputFormats: ['f32-planar'],
    },
    diagnostics: [],
  };
}

describe('audio_context_manager', () => {
  afterEach(() => {
    resetSharedAudioContextForTests();
  });

  it('converts planar PCM to AudioBuffer via OfflineAudioContext', () => {
    if (typeof OfflineAudioContext === 'undefined') {
      return;
    }
    const clip = makeClip(48_000, 2, 480);
    const buffer = pcmClipToOfflineAudioBuffer(clip);
    expect(buffer.sampleRate).toBe(48_000);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(480);
    expect(buffer.getChannelData(0)[0]).toBeCloseTo(clip.planes[0]![0]!, 5);
  });

  it('reports AudioContext availability', () => {
    expect(typeof isAudioContextAvailable()).toBe('boolean');
  });

  it('round-trips AudioBuffer ↔ PcmAudioClip', () => {
    if (typeof OfflineAudioContext === 'undefined') return;
    const clip = makeClip(48_000, 1, 240);
    const buffer = pcmClipToOfflineAudioBuffer(clip);
    const back = audioBufferToPcmClip(buffer, { clipId: 'roundtrip', sourceTrackId: 'a0' });
    expect(back.sampleCount).toBe(240);
    expect(back.channels).toBe(1);
    expect(back.planes[0]![10]).toBeCloseTo(clip.planes[0]![10]!, 5);
  });

  it('bakes a stream_source stage like source', async () => {
    if (typeof OfflineAudioContext === 'undefined') return;
    const clip = makeClip(48_000, 1, 480);
    const baked = await renderPcmThroughWebAudioChain(clip, [
      {
        kind: 'stream_source',
        nodeDefinitionId: 'ring_buffer_source',
        params: { gain: 1, playbackRate: 1 },
      },
      { kind: 'gain', nodeDefinitionId: 'audio_gain', params: { gain: 1 } },
    ]);
    expect(baked.sampleCount).toBe(480);
  });

  it('bakes a gain stage through OfflineAudioContext', async () => {
    if (typeof OfflineAudioContext === 'undefined') return;
    const clip = makeClip(48_000, 1, 480);
    const baked = await renderPcmThroughWebAudioChain(clip, [
      { kind: 'source', nodeDefinitionId: 'ring_buffer_source', params: { gain: 0.5, playbackRate: 1 } },
      { kind: 'gain', nodeDefinitionId: 'audio_gain', params: { gain: 2 } },
    ]);
    expect(baked.sampleCount).toBe(480);
    expect(Math.abs(baked.planes[0]![100]!)).toBeCloseTo(Math.abs(clip.planes[0]![100]!), 1);
  });
});

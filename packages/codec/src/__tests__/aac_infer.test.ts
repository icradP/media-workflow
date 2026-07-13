import { describe, expect, it } from 'vitest';
import {
  buildAscFromAudioConfigRecord,
  buildAscFromAudioParams,
} from '../aac/asc.js';
import { inferAudioCodecConfig } from '../codec_config/infer.js';
import type { AudioMediaTrack, MediaAsset, MediaSample } from '@media-workflow/core';

describe('AAC codec config inference', () => {
  it('builds ASC for 8 kHz mono AAC-LC', () => {
    const asc = buildAscFromAudioParams({
      audioObjectType: 2,
      sampleRate: 8_000,
      channels: 1,
    });
    expect(asc?.byteLength).toBe(2);
    expect(asc?.[0]).toBe(0x15);
    expect(asc?.[1]).toBe(0x88);
  });

  it('builds ASC from parsed FLV audio config metadata', () => {
    const asc = buildAscFromAudioConfigRecord({
      audioObjectType: 2,
      _samplingFrequency_value: 8_000,
      _channelConfiguration_value: 1,
    });
    expect(asc?.byteLength).toBe(2);
  });

  it('infers ASC from track sample rate when sequence header is missing', () => {
    const track: AudioMediaTrack = {
      trackId: 'flv:audio:audio',
      index: 1,
      kind: 'audio',
      codec: 'AAC',
      codecFamily: 'aac',
      codecConfig: null,
      sampleRate: 8_000,
      channels: 1,
      sampleCount: 1,
      metadata: {},
    };
    const asset = {
      container: { format: 'flv' },
      source: { data: new Uint8Array(0) },
      samples: [] as MediaSample[],
    } as MediaAsset;

    const asc = inferAudioCodecConfig(track, asset, []);
    expect(asc?.byteLength).toBe(2);
  });
});

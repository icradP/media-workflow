import { describe, expect, it } from 'vitest';
import {
  audioDestinationNode,
  audioBiquadFilterNode,
  createWebAudioHandle,
  isLiveGraphNodeId,
  isRealtimeNodeId,
  ringBufferSourceNode,
  webaudioToPcmNode,
} from '../realtime/index.js';
import { deviceCaptureNode } from '../source/device_capture.js';
import type {
  ExecuteContext,
  MediaSource,
  PcmAudioClip,
  WebAudioHandle,
} from '@media-workflow/core';

const ctx: ExecuteContext = {
  signal: new AbortController().signal,
  log: { debug() {}, info() {}, warn() {}, error() {} },
  resources: { track() {}, disposeAll() {} },
};

function mediaSource(): MediaSource {
  return {
    sourceId: 's',
    version: '1',
    kind: 'memory',
    name: 'tone.wav',
    size: 4,
    data: new Uint8Array([1, 2, 3, 4]),
    metadata: {},
  };
}

function tonePcm(): PcmAudioClip {
  return {
    clipId: 'dry',
    sourceTrackId: 'a0',
    ptsUs: 0,
    durationUs: 10_000,
    sampleRate: 48_000,
    channels: 1,
    sampleCount: 480,
    format: 'f32-planar',
    planes: [Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 10) * 0.25)],
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

const emptyRingInputs = {
  source: undefined,
  pcm: undefined,
  audio: undefined,
  video: undefined,
  frame: undefined,
  packets: undefined,
  track: undefined,
  liveIn: undefined,
  audioIn: undefined,
};

const defaultRingParams = {
  fillMode: 'static_once',
  ioMode: 'producer_push',
  clockMode: 'realtime',
  rate: 1,
  targetSampleRate: 0,
  targetFrameRate: 0,
  capacitySeconds: 1,
  underrunPolicy: 'silence',
  overrunPolicy: 'drop_oldest',
  loop: true,
  gain: 1,
};

describe('realtime audio nodes', () => {
  it('identifies realtime / live graph node ids', () => {
    expect(isRealtimeNodeId('ring_buffer_source')).toBe(true);
    expect(isRealtimeNodeId('audio_source')).toBe(false);
    expect(isRealtimeNodeId('device_capture')).toBe(false);
    expect(isLiveGraphNodeId('device_capture')).toBe(true);
    expect(isRealtimeNodeId('wav_player')).toBe(false);
  });

  it('device_capture exposes live webaudio pins', () => {
    expect(deviceCaptureNode.outputs.stream?.type).toBe('live_stream');
    expect(deviceCaptureNode.outputs.out?.type).toBe('webaudio');
    expect(deviceCaptureNode.id).toBe('device_capture');
  });

  it('ring_buffer_source requires at least one pin', async () => {
    await expect(
      ringBufferSourceNode.execute(ctx, {
        inputs: emptyRingInputs,
        params: defaultRingParams,
      }),
    ).rejects.toThrow(/static pins and\/or live inputs/);
  });

  it('ring_buffer_source static_once writes RingBufferConfig on stream.ring', async () => {
    const pcm = tonePcm();
    const result = await ringBufferSourceNode.execute(ctx, {
      inputs: { ...emptyRingInputs, pcm },
      params: {
        ...defaultRingParams,
        fillMode: 'static_once',
        rate: 0.8,
        capacitySeconds: 2,
        underrunPolicy: 'loop',
        gain: 0.5,
      },
    });
    expect(result.stream.ring).toEqual({
      fillMode: 'static_once',
      ioMode: 'producer_push',
      clockMode: 'realtime',
      rate: 0.8,
      targetSampleRate: 0,
      targetFrameRate: 0,
      capacitySeconds: 2,
      underrunPolicy: 'loop',
      overrunPolicy: 'drop_oldest',
      loop: true,
      gain: 0.5,
    });
    expect(result.out.kind).toBe('stream_source');
    expect(JSON.parse(result.status).fillMode).toBe('static_once');
  });

  it('ring_buffer_source continuous without live input fails', async () => {
    await expect(
      ringBufferSourceNode.execute(ctx, {
        inputs: { ...emptyRingInputs, pcm: tonePcm() },
        params: { ...defaultRingParams, fillMode: 'continuous' },
      }),
    ).rejects.toThrow(/continuous requires live_stream or webaudio/);
  });

  it('ring_buffer_source continuous with audioIn writes config', async () => {
    const upstream = createWebAudioHandle('stream_source', 'device_capture', { gain: 1 });
    const result = await ringBufferSourceNode.execute(ctx, {
      inputs: { ...emptyRingInputs, audioIn: upstream },
      params: {
        ...defaultRingParams,
        fillMode: 'continuous',
        ioMode: 'producer_push',
        capacitySeconds: 0.5,
        overrunPolicy: 'drop_newest',
      },
    });
    expect(result.stream.ring?.fillMode).toBe('continuous');
    expect(result.stream.ring?.overrunPolicy).toBe('drop_newest');
    expect(result.stream.origin).toBe('device');
    expect(result.out.chain).toHaveLength(2);
    expect(JSON.parse(result.status).payloadKinds).toContain('audioIn');
  });

  it('ring_buffer_source accepts media_source like former audio_source', async () => {
    const result = await ringBufferSourceNode.execute(ctx, {
      inputs: { ...emptyRingInputs, source: mediaSource() },
      params: { ...defaultRingParams, gain: 0.25, rate: 1 },
    });
    expect(result.out.kind).toBe('stream_source');
    expect(result.out.params.gain).toBe(0.25);
    expect(JSON.parse(result.status).payloadKinds).toContain('source');
  });

  it('ring_buffer_source accepts encoded packets without pcm', async () => {
    const result = await ringBufferSourceNode.execute(ctx, {
      inputs: {
        ...emptyRingInputs,
        packets: [{
          packetId: 'p0',
          sourceSampleId: 's0',
          trackId: 'v0',
          codecFamily: 'h264',
          bitstreamFormat: 'avcc',
          data: new Uint8Array([0, 0, 0, 1]),
          ptsUs: 0,
          dtsUs: 0,
          isKey: true,
          metadata: {},
        }],
      },
      params: defaultRingParams,
    });
    expect(result.stream.mediaKind).toBe('video');
    expect(result.stream.hasPcm).toBe(false);
    expect(JSON.parse(result.status).payloadKinds).toContain('packets');
  });

  it('audio_biquadfilter accumulates chain and destination validates webaudio', async () => {
    const handle = createWebAudioHandle('stream_source', 'ring_buffer_source', {
      gain: 1,
      rate: 1,
    });
    const filtered = await audioBiquadFilterNode.execute(ctx, {
      inputs: { in: handle },
      params: { type: 'lowpass', frequency: 800, Q: 1, detune: 0 },
    });
    expect(filtered.out.kind).toBe('biquadfilter');
    expect(filtered.out.chain).toHaveLength(2);

    const dest = await audioDestinationNode.execute(ctx, {
      inputs: { in: filtered.out as WebAudioHandle },
      params: {},
    });
    expect(JSON.parse(dest.status).kind).toBe('destination');
  });

  it('webaudio_to_pcm bakes dry PCM through the chain', async () => {
    if (typeof OfflineAudioContext === 'undefined') return;

    const pcm = tonePcm();
    const source = createWebAudioHandle('stream_source', 'ring_buffer_source', {
      gain: 1,
      playbackRate: 1,
    });
    const filtered = await audioBiquadFilterNode.execute(ctx, {
      inputs: { in: source },
      params: { type: 'lowpass', frequency: 8_000, Q: 1, detune: 0 },
    });
    const baked = await webaudioToPcmNode.execute(ctx, {
      inputs: { in: filtered.out, pcm },
      params: { maxDurationSeconds: 5 },
    });
    expect(baked.pcm.sampleCount).toBeGreaterThan(0);
    expect(baked.pcm.backend.id).toBe('webaudio-offline');
  });
});

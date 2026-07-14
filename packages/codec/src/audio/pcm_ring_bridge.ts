import type {
  DecodedVideoFrame,
  EncodedPacket,
  EncodedTrack,
  PcmAudioClip,
  RingBufferConfig,
  RingClockMode,
} from '@media-workflow/core';
import { connectAudioNodes, getAudioContext } from './audio_context_manager.js';
import {
  clockPacketsFromDecodedFrames,
  DecodedFrameSidecar,
} from './decoded_frame_sidecar.js';
import { TimedPacketRing } from './pcm_sample_ring.js';
import { PCM_RING_WORKLET_NAME, PCM_RING_WORKLET_SOURCE } from './pcm_ring_worklet.js';
import {
  decodedWindowCapacity,
  StreamingVideoDecoder,
} from '../video/streaming_video_decoder.js';

const MIN_CAPACITY_SAMPLES = 128;

export interface PresentationAdvanceInput {
  clockMode: RingClockMode;
  /** Used by fixed_rate; ignored when 0 or realtime. */
  targetFrameRate: number;
  rate: number;
  /** Wall-clock elapsed since last pull (µs), already unscaled. */
  wallStepUs: number;
  /** Leftover µs for fixed_rate quantisation. */
  fixedRateCarryUs: number;
}

export interface PresentationAdvanceResult {
  advanceUs: number;
  nextCarryUs: number;
}

/**
 * How far to move the presentation clock this pull.
 * - realtime: follow wall time × rate (PTS-scheduled playback)
 * - fixed_rate: advance in 1/fps ticks once enough wall time has accrued
 */
export function computePresentationAdvanceUs(
  input: PresentationAdvanceInput,
): PresentationAdvanceResult {
  const rate = Math.max(0.05, input.rate || 1);
  const wallStepUs = Math.max(0, input.wallStepUs) * rate;

  if (input.clockMode === 'fixed_rate' && input.targetFrameRate > 0) {
    const framePeriodUs = Math.round(1_000_000 / input.targetFrameRate);
    let carry = Math.max(0, input.fixedRateCarryUs) + wallStepUs;
    const ticks = Math.floor(carry / framePeriodUs);
    if (ticks <= 0) {
      return { advanceUs: 0, nextCarryUs: carry };
    }
    carry -= ticks * framePeriodUs;
    // Cap catch-up after background tab (~1s of frames).
    const maxTicks = Math.max(1, Math.ceil(input.targetFrameRate));
    const applied = Math.min(ticks, maxTicks);
    return {
      advanceUs: applied * framePeriodUs,
      nextCarryUs: carry,
    };
  }

  return { advanceUs: wallStepUs, nextCarryUs: 0 };
}

const workletReady = new WeakMap<BaseAudioContext, Promise<void>>();

async function ensurePcmRingWorklet(context: BaseAudioContext): Promise<void> {
  const existing = workletReady.get(context);
  if (existing) return existing;

  if (!('audioWorklet' in context) || typeof context.audioWorklet?.addModule !== 'function') {
    throw new Error('AudioWorklet is required (ScriptProcessorNode is not supported)');
  }

  const pending = (async () => {
    const blob = new Blob([PCM_RING_WORKLET_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  })();

  workletReady.set(context, pending);
  try {
    await pending;
  } catch (error) {
    workletReady.delete(context);
    throw error;
  }
}

export interface PcmRingAudioBridge {
  /** Connect upstream continuous sources here (continuous fillMode). */
  input: AudioNode;
  /** Wire this into Gain/Filter/Destination. */
  output: AudioNode;
  gain: GainNode;
  worklet: AudioWorkletNode;
  packetRing?: TimedPacketRing;
  frameSidecar?: DecodedFrameSidecar;
  streamingDecoder?: StreamingVideoDecoder;
  setRate: (rate: number) => void;
  setGain: (gain: number) => void;
  /** Pull due encoded packets since last call (pts clock). */
  pullPackets: (deltaUs?: number) => EncodedPacket[];
  /**
   * Sync pull: sidecar path resolves immediately; stream path returns last presentable
   * and kicks an async decode tick.
   */
  pullFrames: (deltaUs?: number) => DecodedVideoFrame[];
  /** Prefer this for EncodedTrack stream-decode (awaits WebCodecs progress). */
  pullFramesAsync: (deltaUs?: number) => Promise<DecodedVideoFrame[]>;
  /** Current presentation clock (µs), for Live status / flow diagnostics. */
  presentationClockUs: () => number;
  stop: () => void;
  stats: () => {
    available: number;
    underruns: number;
    overruns: number;
    packetQueue: number;
    frameCache: number;
  };
}

export interface CreatePcmRingAudioBridgeOptions {
  context?: AudioContext;
  config: RingBufferConfig;
  channels?: number;
  sampleRate?: number;
  /** static_once: prefill from clip (respects capacitySeconds). */
  clip?: PcmAudioClip;
  /** Optional encoded packets for pts-clocked ring (static or continuous push later). */
  packets?: EncodedPacket[];
  /**
   * Decoded frames for video Live preview sidecar fallback.
   * Ignored for pull when encodedTrack is provided (stream decode preferred).
   */
  frames?: DecodedVideoFrame[];
  /**
   * Preferred Live video path: clocked WebCodecs decode into a short frame window.
   */
  encodedTrack?: EncodedTrack;
}

/**
 * AudioWorklet PCM ring bridge (no ScriptProcessorNode).
 * - continuous: upstream → input → worklet → gain
 * - static_once: clip filled into worklet ring; worklet → gain
 * - video: EncodedTrack → StreamingVideoDecoder, or decoded frames sidecar
 */
export async function createPcmRingAudioBridge(
  options: CreatePcmRingAudioBridgeOptions,
): Promise<PcmRingAudioBridge> {
  const context = options.context ?? getAudioContext();
  const config = options.config;
  const sampleRate = options.sampleRate
    || (config.targetSampleRate > 0 ? config.targetSampleRate : 0)
    || options.clip?.sampleRate
    || context.sampleRate;
  const channels = Math.max(1, options.channels ?? options.clip?.channels ?? 1);
  const capacitySamples = Math.max(
    MIN_CAPACITY_SAMPLES,
    Math.floor(sampleRate * Math.max(0.05, config.capacitySeconds)),
  );

  await ensurePcmRingWorklet(context);

  const input = context.createGain();
  input.gain.value = 1;
  const gain = context.createGain();
  gain.gain.value = config.gain;

  const worklet = new AudioWorkletNode(context, PCM_RING_WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [channels],
    channelCount: channels,
    channelCountMode: 'explicit',
    processorOptions: {
      capacitySamples,
      channels,
      fillMode: config.fillMode,
      underrunPolicy: config.underrunPolicy,
      overrunPolicy: config.overrunPolicy,
      loop: config.loop,
      rate: Math.max(0.05, config.rate),
    },
  });

  let lastStats = { available: 0, underruns: 0, overruns: 0 };
  worklet.port.onmessage = event => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'stats' || data.type === 'filled') {
      lastStats = {
        available: Number(data.available) || 0,
        underruns: Number(data.underruns) || lastStats.underruns,
        overruns: Number(data.overruns) || lastStats.overruns,
      };
    }
  };

  worklet.port.postMessage({
    type: 'configure',
    fillMode: config.fillMode,
    underrunPolicy: config.underrunPolicy,
    overrunPolicy: config.overrunPolicy,
    loop: config.loop,
    rate: Math.max(0.05, config.rate),
  });

  if (config.fillMode === 'static_once' && options.clip) {
    const count = Math.min(capacitySamples, options.clip.sampleCount);
    const planes = Array.from({ length: channels }, (_, channel) => {
      const src = options.clip!.planes[Math.min(channel, options.clip!.planes.length - 1)]
        ?? new Float32Array(count);
      return Float32Array.from(src.subarray(0, count));
    });
    worklet.port.postMessage({
      type: 'fill',
      planes,
      sampleCount: count,
    });
  }

  let packetRing: TimedPacketRing | undefined;
  let frameSidecar: DecodedFrameSidecar | undefined;
  let streamingDecoder: StreamingVideoDecoder | undefined;
  let rate = Math.max(0.05, config.rate);
  let presentationClockUs = 0;
  let fixedRateCarryUs = 0;
  let lastPresentable: DecodedVideoFrame | undefined;
  let streamTickChain: Promise<void> = Promise.resolve();

  const preferStreamDecode = Boolean(
    options.encodedTrack?.packets.length && options.encodedTrack.decoderConfig,
  );

  const clockPackets = preferStreamDecode
    ? options.encodedTrack!.packets
    : options.packets?.length
      ? options.packets
      : options.frames?.length
        ? clockPacketsFromDecodedFrames(options.frames)
        : undefined;

  if (preferStreamDecode) {
    const fps = Math.max(1, config.targetFrameRate || 30);
    streamingDecoder = new StreamingVideoDecoder({
      decoderConfig: options.encodedTrack!.decoderConfig,
      capacityFrames: decodedWindowCapacity(config.capacitySeconds, fps),
      lookaheadUs: Math.round(Math.max(0.05, config.capacitySeconds) * 1_000_000),
    });
    streamingDecoder.setPackets(options.encodedTrack!.packets);
    presentationClockUs = streamingDecoder.firstPtsUs();
  } else if (clockPackets?.length || options.frames?.length) {
    const continuousCapacity = Math.max(
      8,
      Math.floor(config.capacitySeconds * Math.max(1, config.targetFrameRate || 30)),
    );
    const preloadCount = clockPackets?.length ?? options.frames?.length ?? 8;
    packetRing = new TimedPacketRing({
      capacity: config.fillMode === 'static_once'
        ? Math.max(continuousCapacity, preloadCount)
        : continuousCapacity,
      underrunPolicy: config.underrunPolicy === 'silence' ? 'wait' : config.underrunPolicy,
      overrunPolicy: config.overrunPolicy,
      loop: config.loop,
    });
    if (clockPackets?.length) {
      if (config.fillMode === 'static_once') {
        packetRing.fill(clockPackets);
      } else {
        for (const packet of clockPackets) packetRing.push(packet);
      }
    }
  }

  if (!preferStreamDecode && options.frames?.length) {
    frameSidecar = new DecodedFrameSidecar();
    frameSidecar.fill(
      options.frames,
      clockPackets?.map(packet => packet.packetId),
    );
  }

  let lastPacketPullMs = performance.now();

  connectAudioNodes(input, worklet);
  connectAudioNodes(worklet, gain);

  const advancePresentationClock = (deltaUs?: number): number => {
    const now = performance.now();
    const inferred = Math.round((now - lastPacketPullMs) * 1_000);
    lastPacketPullMs = now;
    const wallStepUs = deltaUs ?? inferred;
    const { advanceUs, nextCarryUs } = computePresentationAdvanceUs({
      clockMode: config.clockMode,
      targetFrameRate: config.targetFrameRate,
      rate,
      wallStepUs,
      fixedRateCarryUs,
    });
    fixedRateCarryUs = nextCarryUs;
    return advanceUs;
  };

  const decodeAtClock = async (clockUs: number): Promise<DecodedVideoFrame[]> => {
    if (!streamingDecoder) return [];
    let clock = clockUs;
    const lastPts = streamingDecoder.lastPtsUs();
    if (config.loop && lastPts > 0 && clock > lastPts + 40_000) {
      await streamingDecoder.resetForLoop();
      clock = streamingDecoder.firstPtsUs();
      presentationClockUs = clock;
    }
    await streamingDecoder.tick(clock);
    const frame = streamingDecoder.pullPresentable(clock);
    lastPresentable = frame ?? lastPresentable;
    return frame ? [frame] : [];
  };

  const pullPackets = (deltaUs?: number): EncodedPacket[] => {
    if (streamingDecoder) {
      // Stream path clocks via pullFrames; avoid double-advance.
      return [];
    }
    if (!packetRing) return [];
    const advance = advancePresentationClock(deltaUs);
    return packetRing.pullDue(advance);
  };

  const pullFramesAsync = async (deltaUs?: number): Promise<DecodedVideoFrame[]> => {
    if (streamingDecoder) {
      const advance = advancePresentationClock(deltaUs);
      presentationClockUs += advance;
      return decodeAtClock(presentationClockUs);
    }

    if (!frameSidecar) return [];
    return frameSidecar.resolveMany(pullPackets(deltaUs));
  };

  const pullFrames = (deltaUs?: number): DecodedVideoFrame[] => {
    if (streamingDecoder) {
      // Advance on the sync rAF path so a slow decode queue cannot eat wall time.
      const advance = advancePresentationClock(deltaUs);
      presentationClockUs += advance;
      const clockSnapshot = presentationClockUs;
      streamTickChain = streamTickChain
        .then(() => decodeAtClock(clockSnapshot))
        .then(frames => {
          if (frames[0]) lastPresentable = frames[0];
        })
        .catch(() => undefined);
      return lastPresentable ? [lastPresentable] : [];
    }
    if (!frameSidecar) return [];
    return frameSidecar.resolveMany(pullPackets(deltaUs));
  };

  return {
    input,
    output: gain,
    gain,
    worklet,
    packetRing,
    frameSidecar,
    streamingDecoder,
    setRate(next) {
      rate = Math.max(0.05, next);
      worklet.port.postMessage({ type: 'setRate', rate });
    },
    setGain(next) {
      gain.gain.value = next;
    },
    pullPackets,
    pullFrames,
    pullFramesAsync,
    presentationClockUs: () => presentationClockUs,
    stop() {
      try {
        worklet.port.postMessage({ type: 'clear' });
        worklet.port.onmessage = null;
        worklet.disconnect();
        input.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
      packetRing?.clear();
      frameSidecar?.clear();
      streamingDecoder?.stop();
    },
    stats() {
      worklet.port.postMessage({ type: 'stats' });
      return {
        ...lastStats,
        packetQueue: packetRing?.size()
          ?? streamingDecoder?.packetCount()
          ?? 0,
        frameCache: frameSidecar?.size()
          ?? streamingDecoder?.decodedCount()
          ?? 0,
      };
    },
  };
}

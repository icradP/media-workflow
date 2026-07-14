import type {
  MediaSource,
  PcmAudioClip,
  WebAudioChainStep,
  WebAudioHandle,
} from '@media-workflow/core';
import { float32PlanarToInterleaved } from '../decode/pcm.js';

const WEBAUDIO_OFFLINE_BACKEND = {
  id: 'webaudio-offline',
  version: '1',
  api: 'software' as const,
  codecFamilies: [] as const,
  inputFormats: [] as const,
  outputFormats: ['f32-planar' as const],
};

let sharedContext: AudioContext | null = null;

export function isAudioContextAvailable(): boolean {
  return typeof globalThis.AudioContext !== 'undefined'
    || typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined';
}

export function getAudioContext(): AudioContext {
  if (!isAudioContextAvailable()) {
    throw new Error('AudioContext is not available in this environment');
  }
  if (!sharedContext || sharedContext.state === 'closed') {
    const Ctor = globalThis.AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
    sharedContext = new Ctor();
  }
  return sharedContext;
}

export async function resumeAudioContext(context = getAudioContext()): Promise<AudioContext> {
  if (context.state === 'suspended') {
    await context.resume();
  }
  return context;
}

export async function suspendAudioContext(context = getAudioContext()): Promise<void> {
  if (context.state === 'running') {
    await context.suspend();
  }
}

export function connectAudioNodes(from: AudioNode, to: AudioNode): void {
  try {
    from.connect(to);
  } catch (error) {
    console.warn('WebAudio connect failed:', error);
  }
}

export function disconnectAudioNodes(from: AudioNode, to?: AudioNode): void {
  try {
    if (to) from.disconnect(to);
    else from.disconnect();
  } catch (error) {
    console.warn('WebAudio disconnect failed:', error);
  }
}

export function pcmClipToAudioBuffer(
  clip: PcmAudioClip,
  context = getAudioContext(),
): AudioBuffer {
  const buffer = context.createBuffer(clip.channels, clip.sampleCount, clip.sampleRate);
  for (let channel = 0; channel < clip.channels; channel++) {
    const plane = clip.planes[channel];
    if (!plane) continue;
    const channelData = buffer.getChannelData(channel);
    channelData.set(plane.subarray(0, Math.min(plane.length, clip.sampleCount)));
  }
  return buffer;
}

export async function decodeMediaSourceToAudioBuffer(
  source: MediaSource,
  context = getAudioContext(),
): Promise<AudioBuffer> {
  const copy = source.data.slice().buffer;
  return context.decodeAudioData(copy);
}

export async function decodeBytesToAudioBuffer(
  data: Uint8Array,
  context = getAudioContext(),
): Promise<AudioBuffer> {
  const copy = data.slice().buffer;
  return context.decodeAudioData(copy);
}

/** Build an AudioBuffer from interleaved f32 planar clip without a live context (tests). */
export function pcmClipToOfflineAudioBuffer(clip: PcmAudioClip): AudioBuffer {
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('OfflineAudioContext is not available');
  }
  const context = new OfflineAudioContext(
    clip.channels,
    Math.max(1, clip.sampleCount),
    clip.sampleRate,
  );
  return pcmClipToAudioBuffer(clip, context as unknown as AudioContext);
}

export function interleavedFloat32FromPcm(clip: PcmAudioClip): Float32Array {
  return float32PlanarToInterleaved(clip.planes, clip.channels, clip.sampleCount);
}

export interface PcmMediaStreamPump {
  stream: MediaStream;
  bufferSource: AudioBufferSourceNode;
  gain: GainNode;
  destination: MediaStreamAudioDestinationNode;
  stop: () => void;
}

/** Pump a static PCM clip into a MediaStream (loopable) for Live MediaStreamSource chains. */
export function createPcmMediaStreamPump(
  clip: PcmAudioClip,
  options: {
    loop?: boolean;
    gain?: number;
    playbackRate?: number;
    context?: AudioContext;
  } = {},
): PcmMediaStreamPump {
  const context = options.context ?? getAudioContext();
  const buffer = pcmClipToAudioBuffer(clip, context);
  const bufferSource = context.createBufferSource();
  bufferSource.buffer = buffer;
  bufferSource.loop = options.loop !== false;
  bufferSource.playbackRate.value = Math.max(0.05, Number(options.playbackRate) || 1);

  const gain = context.createGain();
  gain.gain.value = Number.isFinite(Number(options.gain)) ? Number(options.gain) : 1;

  const destination = context.createMediaStreamDestination();
  bufferSource.connect(gain);
  gain.connect(destination);

  return {
    stream: destination.stream,
    bufferSource,
    gain,
    destination,
    stop: () => {
      try {
        bufferSource.stop();
      } catch {
        /* already stopped */
      }
      try {
        bufferSource.disconnect();
        gain.disconnect();
        destination.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}

export function audioBufferToPcmClip(
  buffer: AudioBuffer,
  options?: {
    clipId?: string;
    sourceTrackId?: string;
    ptsUs?: number;
    selectionId?: string;
  },
): PcmAudioClip {
  const channels = buffer.numberOfChannels;
  const sampleCount = buffer.length;
  const planes = Array.from({ length: channels }, (_, channel) => {
    const data = buffer.getChannelData(channel);
    return new Float32Array(data);
  });
  const sampleRate = buffer.sampleRate;
  return {
    clipId: options?.clipId ?? `webaudio:${sampleRate}:${sampleCount}`,
    selectionId: options?.selectionId,
    sourceTrackId: options?.sourceTrackId ?? 'webaudio',
    ptsUs: options?.ptsUs ?? 0,
    durationUs: Math.max(1, Math.round((sampleCount / sampleRate) * 1_000_000)),
    sampleRate,
    channels,
    sampleCount,
    format: 'f32-planar',
    planes,
    backend: {
      id: WEBAUDIO_OFFLINE_BACKEND.id,
      version: WEBAUDIO_OFFLINE_BACKEND.version,
      api: WEBAUDIO_OFFLINE_BACKEND.api,
      codecFamilies: [],
      inputFormats: [],
      outputFormats: ['f32-planar'],
    },
    diagnostics: [],
  };
}

export interface RenderWebAudioChainOptions {
  /** Soft cap so accidental huge clips don't hang the UI. */
  maxDurationSeconds?: number;
}

/**
 * Bake dry PCM through a serial Web Audio effect chain (OfflineAudioContext).
 * Applies source gain/playbackRate, then gain/biquad stages; skips analyser/destination.
 */
export async function renderPcmThroughWebAudioChain(
  clip: PcmAudioClip,
  chain: WebAudioChainStep[] | WebAudioHandle,
  options: RenderWebAudioChainOptions = {},
): Promise<PcmAudioClip> {
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('OfflineAudioContext is not available');
  }

  const steps = Array.isArray(chain) ? chain : chain.chain;
  const processSteps = steps.filter(step =>
    step.kind === 'source'
    || step.kind === 'stream_source'
    || step.kind === 'gain'
    || step.kind === 'biquadfilter',
  );

  const sourceStep = processSteps.find(
    step => step.kind === 'source' || step.kind === 'stream_source',
  );
  const playbackRate = Math.max(0.05, Number(sourceStep?.params.playbackRate) || 1);
  const maxDurationSeconds = options.maxDurationSeconds ?? 120;
  const outputSampleCount = Math.max(
    1,
    Math.min(
      Math.ceil(clip.sampleCount / playbackRate),
      Math.floor(clip.sampleRate * maxDurationSeconds),
    ),
  );

  const context = new OfflineAudioContext(
    clip.channels,
    outputSampleCount,
    clip.sampleRate,
  );
  const inputBuffer = pcmClipToAudioBuffer(clip, context as unknown as AudioContext);
  const bufferSource = context.createBufferSource();
  bufferSource.buffer = inputBuffer;
  bufferSource.loop = false;
  bufferSource.playbackRate.value = playbackRate;

  let current: AudioNode = bufferSource;
  const sourceGain = Number(sourceStep?.params.gain);
  if (Number.isFinite(sourceGain)) {
    const gain = context.createGain();
    gain.gain.value = sourceGain;
    current.connect(gain);
    current = gain;
  }

  for (const step of processSteps) {
    if (step.kind === 'source' || step.kind === 'stream_source') continue;
    if (step.kind === 'gain') {
      const gain = context.createGain();
      gain.gain.value = Number(step.params.gain) || 1;
      current.connect(gain);
      current = gain;
      continue;
    }
    if (step.kind === 'biquadfilter') {
      const biquad = context.createBiquadFilter();
      biquad.type = String(step.params.type ?? 'lowpass') as BiquadFilterType;
      biquad.frequency.value = Number(step.params.frequency) || 350;
      biquad.Q.value = Number(step.params.Q) || 1;
      biquad.detune.value = Number(step.params.detune) || 0;
      current.connect(biquad);
      current = biquad;
    }
  }

  current.connect(context.destination);
  bufferSource.start(0);
  const rendered = await context.startRendering();
  return audioBufferToPcmClip(rendered, {
    clipId: `${clip.clipId}:webaudio`,
    sourceTrackId: clip.sourceTrackId,
    ptsUs: clip.ptsUs,
    selectionId: clip.selectionId,
  });
}

export function resetSharedAudioContextForTests(): void {
  if (sharedContext && sharedContext.state !== 'closed') {
    void sharedContext.close();
  }
  sharedContext = null;
}

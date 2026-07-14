import type {
  AudioBufferData,
  DecodedVideoClip,
  DecodedVideoFrame,
  EncodedPacket,
  EncodedTrack,
  LiveStreamHandle,
  MediaSource,
  NodeDefinition,
  PcmAudioClip,
  RingBufferConfig,
  RingClockMode,
  RingFillMode,
  RingIoMode,
  RingOverrunPolicy,
  RingUnderrunPolicy,
  WebAudioHandle,
} from '@media-workflow/core';
import { createWebAudioHandle } from './handles.js';

const FILL_MODES: RingFillMode[] = ['static_once', 'continuous'];
const IO_MODES: RingIoMode[] = ['producer_push', 'consumer_pull'];
const CLOCK_MODES: RingClockMode[] = ['realtime', 'fixed_rate'];
const UNDERRUN_POLICIES: RingUnderrunPolicy[] = ['silence', 'wait', 'loop'];
const OVERRUN_POLICIES: RingOverrunPolicy[] = ['drop_oldest', 'block_producer', 'drop_newest'];

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = String(value ?? '');
  return (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
}

function resolveFillMode(
  params: Record<string, unknown>,
  hasStatic: boolean,
  hasLive: boolean,
): RingFillMode {
  const explicit = String(params.fillMode ?? '').trim();
  if (FILL_MODES.includes(explicit as RingFillMode)) return explicit as RingFillMode;
  if (hasLive) return 'continuous';
  return 'static_once';
}

function buildRingConfig(
  params: Record<string, unknown>,
  fillMode: RingFillMode,
): RingBufferConfig {
  return {
    fillMode,
    ioMode: pickEnum(params.ioMode, IO_MODES, 'producer_push'),
    clockMode: pickEnum(params.clockMode, CLOCK_MODES, 'realtime'),
    rate: Math.max(0.05, Number(params.rate ?? params.playbackRate) || 1),
    targetSampleRate: Math.max(0, Number(params.targetSampleRate) || 0),
    targetFrameRate: Math.max(0, Number(params.targetFrameRate) || 0),
    capacitySeconds: Math.max(0.05, Number(params.capacitySeconds) || 1),
    underrunPolicy: pickEnum(params.underrunPolicy, UNDERRUN_POLICIES, 'silence'),
    overrunPolicy: pickEnum(params.overrunPolicy, OVERRUN_POLICIES, 'drop_oldest'),
    loop: params.loop !== false,
    gain: Number.isFinite(Number(params.gain)) ? Number(params.gain) : 1,
  };
}

/**
 * Bounded ring-buffer clock for static prefetch and continuous live ingest.
 * Live session owns native buffers; this node emits descriptors + webaudio handles.
 */
export const ringBufferSourceNode: NodeDefinition<
  {
    source: 'media_source';
    pcm: 'pcm_audio';
    audio: 'audio_buffer';
    video: 'decoded_video';
    frame: 'video_frame';
    packets: 'encoded_packets';
    track: 'encoded_track';
    liveIn: 'live_stream';
    audioIn: 'webaudio';
  },
  { stream: 'live_stream'; out: 'webaudio'; status: 'string' }
> = {
  id: 'ring_buffer_source',
  category: 'realtime',
  displayName: 'Ring Buffer Source',
  description:
    'Bounded sample/packet ring for static_once and continuous live ingest. '
    + 'clockMode=realtime follows PTS via wall clock; fixed_rate emits on targetFrameRate ticks. '
    + 'capacitySeconds is the decode/PCM window (EncodedTrack → stream WebCodecs), not clip length.',
  inputs: {
    source: { type: 'media_source', label: 'Media Source', optional: true },
    pcm: { type: 'pcm_audio', label: 'PCM', optional: true },
    audio: { type: 'audio_buffer', label: 'Audio Buffer', optional: true },
    video: { type: 'decoded_video', label: 'Decoded Video', optional: true },
    frame: { type: 'video_frame', label: 'Video Frame', optional: true },
    packets: { type: 'encoded_packets', label: 'Encoded Packets', optional: true },
    track: { type: 'encoded_track', label: 'Encoded Track', optional: true },
    liveIn: { type: 'live_stream', label: 'Live Stream In', optional: true },
    audioIn: { type: 'webaudio', label: 'Web Audio In', optional: true },
  },
  outputs: {
    stream: { type: 'live_stream', label: 'Live Stream' },
    out: { type: 'webaudio', label: 'Web Audio' },
    status: { type: 'string', label: 'Status' },
  },
  params: {
    fillMode: {
      name: 'fillMode',
      type: 'enum',
      default: 'static_once',
      values: FILL_MODES,
    },
    ioMode: {
      name: 'ioMode',
      type: 'enum',
      default: 'producer_push',
      values: IO_MODES,
    },
    clockMode: {
      name: 'clockMode',
      type: 'enum',
      default: 'realtime',
      values: CLOCK_MODES,
    },
    rate: {
      name: 'rate',
      type: 'number',
      default: 1,
      min: 0.05,
      max: 4,
      step: 0.01,
    },
    targetSampleRate: {
      name: 'targetSampleRate',
      type: 'number',
      default: 0,
      min: 0,
      step: 1_000,
    },
    targetFrameRate: {
      name: 'targetFrameRate',
      type: 'number',
      default: 0,
      min: 0,
      max: 120,
      step: 1,
    },
    capacitySeconds: {
      name: 'capacitySeconds',
      type: 'number',
      default: 1,
      min: 0.05,
      max: 600,
      step: 0.05,
    },
    underrunPolicy: {
      name: 'underrunPolicy',
      type: 'enum',
      default: 'silence',
      values: UNDERRUN_POLICIES,
    },
    overrunPolicy: {
      name: 'overrunPolicy',
      type: 'enum',
      default: 'drop_oldest',
      values: OVERRUN_POLICIES,
    },
    loop: { name: 'loop', type: 'boolean', default: true },
    gain: { name: 'gain', type: 'number', default: 1, min: 0, max: 4, step: 0.01 },
  },
  cachePolicy: 'never',
  async execute(ctx, { inputs, params }) {
    const source = inputs.source as MediaSource | undefined;
    const pcm = inputs.pcm as PcmAudioClip | undefined;
    const audio = inputs.audio as AudioBufferData | undefined;
    const video = inputs.video as DecodedVideoClip | undefined;
    const frame = inputs.frame as DecodedVideoFrame | undefined;
    const packets = inputs.packets as EncodedPacket[] | undefined;
    const track = inputs.track as EncodedTrack | undefined;
    const liveIn = inputs.liveIn as LiveStreamHandle | undefined;
    const audioIn = inputs.audioIn as WebAudioHandle | undefined;

    const bound = {
      source: Boolean(source),
      pcm: Boolean(pcm),
      audio: Boolean(audio),
      video: Boolean(video),
      frame: Boolean(frame),
      packets: Boolean(packets?.length),
      track: Boolean(track?.packets.length),
      liveIn: Boolean(liveIn),
      audioIn: Boolean(audioIn),
    };
    const hasStatic = bound.source || bound.pcm || bound.audio || bound.video
      || bound.frame || bound.packets || bound.track;
    const hasLive = bound.liveIn || bound.audioIn;

    if (!hasStatic && !hasLive) {
      throw new Error(
        'RingBufferSource: connect static pins and/or live inputs '
        + '(media_source / pcm / video / packets / live_stream / webaudio)',
      );
    }

    const fillMode = resolveFillMode(params, hasStatic, hasLive);
    if (fillMode === 'continuous' && !hasLive) {
      throw new Error(
        'RingBufferSource: fillMode=continuous requires live_stream or webaudio in',
      );
    }
    if (fillMode === 'static_once' && !hasStatic) {
      throw new Error(
        'RingBufferSource: fillMode=static_once requires at least one static timed pin',
      );
    }

    const ring = buildRingConfig(params, fillMode);
    const hasAudio = bound.source || bound.pcm || bound.audio || bound.audioIn
      || liveIn?.hasPcm
      || (bound.track && track?.kind === 'audio')
      || (bound.packets && packets?.some(p =>
        p.codecFamily === 'aac' || p.codecFamily === 'pcm' || p.codecFamily === 'g711'
        || p.codecFamily === 'mp3' || p.codecFamily === 'opus'
      ));
    const hasVideo = bound.video || bound.frame || liveIn?.hasVideo
      || (bound.track && track?.kind === 'video')
      || (bound.packets && packets?.some(p =>
        p.codecFamily === 'h264' || p.codecFamily === 'h265'
      ));

    const mediaKind = hasAudio && hasVideo ? 'av' : hasVideo ? 'video' : 'audio';
    const payloadKinds = (Object.keys(bound) as Array<keyof typeof bound>).filter(k => bound[k]);
    const origin = hasLive && fillMode === 'continuous'
      ? (liveIn?.origin ?? 'device')
      : 'static';

    const stream: LiveStreamHandle = {
      streamId: `ring:${
        pcm?.clipId
        ?? source?.sourceId
        ?? liveIn?.streamId
        ?? video?.requestId
        ?? track?.trackId
        ?? frame?.frameId
        ?? 'buf'
      }`,
      origin,
      mediaKind,
      nodeDefinitionId: 'ring_buffer_source',
      label: payloadKinds.join('+') || source?.name || liveIn?.label,
      hasPcm: Boolean(bound.pcm || bound.audio || bound.source || bound.audioIn || liveIn?.hasPcm),
      hasVideo,
      params: {
        ...ring,
        payloadKinds,
        sourceName: source?.name ?? '',
        pcmSampleCount: pcm?.sampleCount ?? 0,
        audioSampleCount: audio?.sampleCount ?? 0,
        videoFrameCount: video?.frames.length ?? (frame ? 1 : 0),
        packetCount: packets?.length ?? track?.packets.length ?? 0,
        // Compat alias for older Live/bake paths that still read playbackRate
        playbackRate: ring.rate,
      },
      ring,
    };

    const out = createWebAudioHandle(
      'stream_source',
      'ring_buffer_source',
      {
        ...ring,
        playbackRate: ring.rate,
        hasPcm: stream.hasPcm,
        hasVideo,
        payloadKinds,
        sourceName: source?.name ?? '',
      },
      audioIn ? { upstream: audioIn } : undefined,
    );

    ctx.log.info(
      `RingBufferSource: ${fillMode}/${ring.ioMode}/${ring.clockMode} `
      + `rate=${ring.rate} capacity=${ring.capacitySeconds}s · ${payloadKinds.join(', ')}`,
    );
    return {
      stream,
      out,
      status: JSON.stringify({
        mode: 'ring-buffer',
        fillMode: ring.fillMode,
        ioMode: ring.ioMode,
        clockMode: ring.clockMode,
        rate: ring.rate,
        capacitySeconds: ring.capacitySeconds,
        underrunPolicy: ring.underrunPolicy,
        overrunPolicy: ring.overrunPolicy,
        payloadKinds,
        origin,
        mediaKind,
      }),
    };
  },
};

/** @deprecated Use ringBufferSourceNode */
export const staticToStreamNode = ringBufferSourceNode;

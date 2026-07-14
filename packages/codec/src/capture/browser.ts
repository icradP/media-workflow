import type {
  AudioMediaTrack,
  DecodedVideoClip,
  DecodedVideoFrame,
  MediaDiagnostic,
  MediaSelection,
  PcmAudioClip,
  VideoMediaTrack,
} from '@media-workflow/core';
import { WEBCODECS_AAC_BACKEND } from '@media-workflow/core/decoder';
import { resamplePcmClip } from '../decode/resample.js';
import { copyVideoFrame } from '../decode/yuv.js';
import {
  buildCaptureMediaSelection,
  type CaptureSessionInfo,
  type CaptureTrackRole,
} from './selection.js';
import { CAPTURE_WORKLET_NAME, CAPTURE_WORKLET_SOURCE } from './capture_worklet.js';

export interface MediaDeviceSummary {
  deviceId: string;
  label: string;
  kind: 'videoinput' | 'audioinput' | 'audiooutput';
}

export interface DeviceCaptureOptions {
  /** Required when recording via captureFromDevices; unused by openCaptureStreams. */
  durationSeconds?: number;
  enableVideo?: boolean;
  enableMicrophone?: boolean;
  enableSpeaker?: boolean;
  videoDeviceId?: string;
  audioDeviceId?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  /** Target PCM sample rate for captured audio. 0 keeps the device/native rate. */
  sampleRate?: number;
  signal?: AbortSignal;
}

export interface DeviceCaptureResult {
  session: CaptureSessionInfo;
  video?: DecodedVideoClip;
  videoSelection?: MediaSelection;
  microphone?: PcmAudioClip;
  micSelection?: MediaSelection;
  speaker?: PcmAudioClip;
  speakerSelection?: MediaSelection;
  diagnostics: MediaDiagnostic[];
}

const CAPTURE_BACKEND = {
  id: 'browser-capture',
  version: '1.0.0',
  api: 'webcodecs' as const,
  codecFamilies: [] as never[],
  inputFormats: [] as never[],
  outputFormats: ['I420', 'f32-planar'] as Array<'I420' | 'f32-planar'>,
};

export function isBrowserCaptureAvailable(): boolean {
  return typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export async function listMediaDevices(): Promise<MediaDeviceSummary[]> {
  if (!isBrowserCaptureAvailable()) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(device => device.kind === 'videoinput' || device.kind === 'audioinput')
    .map(device => ({
      deviceId: device.deviceId,
      label: device.label || `${device.kind}:${device.deviceId.slice(0, 8) || 'default'}`,
      kind: device.kind,
    }));
}

export interface OpenCaptureStreamsResult {
  streams: MediaStream[];
  videoStream?: MediaStream;
  micStream?: MediaStream;
  speakerStream?: MediaStream;
}

export function stopCaptureStreams(streams: MediaStream[]): void {
  for (const stream of streams) {
    for (const track of stream.getTracks()) track.stop();
  }
}

export async function openCaptureStreams(
  options: DeviceCaptureOptions,
): Promise<OpenCaptureStreamsResult> {
  const enableVideo = options.enableVideo !== false;
  const enableMicrophone = options.enableMicrophone !== false;
  const enableSpeaker = Boolean(options.enableSpeaker);
  if (!enableVideo && !enableMicrophone && !enableSpeaker) {
    throw new Error('DeviceCapture: enable at least one of video, microphone, or speaker');
  }

  const streams: MediaStream[] = [];
  let videoStream: MediaStream | undefined;
  let micStream: MediaStream | undefined;
  let speakerStream: MediaStream | undefined;

  if (enableVideo || enableMicrophone) {
    const userStream = await navigator.mediaDevices.getUserMedia({
      video: enableVideo
        ? {
            deviceId: options.videoDeviceId ? { exact: options.videoDeviceId } : undefined,
            width: { ideal: options.width ?? 640 },
            height: { ideal: options.height ?? 480 },
            frameRate: { ideal: options.frameRate ?? 30 },
          }
        : false,
      audio: enableMicrophone
        ? {
            deviceId: options.audioDeviceId ? { exact: options.audioDeviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
          }
        : false,
    });
    streams.push(userStream);
    if (enableVideo) videoStream = userStream;
    if (enableMicrophone) micStream = userStream;
  }

  if (enableSpeaker) {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    streams.push(displayStream);
    for (const track of displayStream.getVideoTracks()) track.stop();
    speakerStream = new MediaStream(displayStream.getAudioTracks());
  }

  return { streams, videoStream, micStream, speakerStream };
}

export async function captureFromDevices(
  options: DeviceCaptureOptions,
): Promise<DeviceCaptureResult> {
  if (!isBrowserCaptureAvailable()) {
    throw new Error('DeviceCapture: MediaDevices API is not available in this environment');
  }

  const durationSeconds = Math.max(0.1, Number(options.durationSeconds) || 5);
  const durationUs = Math.round(durationSeconds * 1_000_000);
  const startedAt = Date.now();
  const session: CaptureSessionInfo = {
    sessionId: `capture:${startedAt}`,
    version: String(startedAt),
    durationUs,
    label: `Capture ${new Date(startedAt).toISOString()}`,
  };

  const diagnostics: MediaDiagnostic[] = [];
  const opened = await openCaptureStreams(options);

  try {
    const [video, microphoneRaw, speakerRaw] = await Promise.all([
      opened.videoStream ? captureVideoTrack(opened.videoStream, durationUs, options.signal) : undefined,
      opened.micStream ? captureAudioTrack(opened.micStream, 'microphone', durationUs, options.signal) : undefined,
      opened.speakerStream && opened.speakerStream.getAudioTracks().length > 0
        ? captureAudioTrack(opened.speakerStream, 'speaker', durationUs, options.signal)
        : undefined,
    ]);
    const microphone = applyCapturedAudioSampleRate(microphoneRaw, options.sampleRate);
    const speaker = applyCapturedAudioSampleRate(speakerRaw, options.sampleRate);

    const result: DeviceCaptureResult = { session, diagnostics };
    if (video) {
      result.video = video.clip;
      result.videoSelection = buildCaptureMediaSelection({
        session,
        role: 'video',
        track: video.track,
      });
    }
    if (microphone) {
      result.microphone = microphone.clip;
      result.micSelection = buildCaptureMediaSelection({
        session,
        role: 'microphone',
        track: microphone.track,
      });
    }
    if (speaker) {
      result.speaker = speaker.clip;
      result.speakerSelection = buildCaptureMediaSelection({
        session,
        role: 'speaker',
        track: speaker.track,
      });
    }

    return result;
  } finally {
    stopCaptureStreams(opened.streams);
  }
}

export async function captureVideoTrack(
  stream: MediaStream,
  durationUs: number,
  signal?: AbortSignal,
): Promise<{ clip: DecodedVideoClip; track: VideoMediaTrack }> {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('DeviceCapture: video stream has no video track');

  const settings = track.getSettings();
  const width = settings.width ?? 640;
  const height = settings.height ?? 480;
  const trackId = 'capture:video:0';
  const frames: DecodedVideoFrame[] = [];

  if ('MediaStreamTrackProcessor' in globalThis) {
    const Processor = (globalThis as typeof globalThis & {
      MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => {
        readable: ReadableStream<VideoFrame>;
      };
    }).MediaStreamTrackProcessor;
    const processor = new Processor({ track });
    const reader = processor.readable.getReader();
    const deadline = performance.now() + durationUs / 1_000;
    try {
      while (performance.now() < deadline) {
        if (signal?.aborted) break;
        const read = await Promise.race([
          reader.read(),
          sleep(Math.max(1, deadline - performance.now())),
        ]);
        if (!read || !('value' in read) || !read.value) break;
        const frame = read.value as VideoFrame;
        const decoded = await copyVideoFrame(
          frame,
          `${trackId}:${frames.length}`,
          'I420',
        );
        decoded.ptsUs = Math.round(frame.timestamp ?? frames.length * 33_333);
        decoded.durationUs = Math.round(frame.duration ?? 33_333);
        frames.push(decoded);
        frame.close();
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const element = document.createElement('video');
    element.muted = true;
    element.playsInline = true;
    element.srcObject = stream;
    await element.play();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('DeviceCapture: Canvas 2D is unavailable');

    const frameIntervalUs = 33_333;
    const frameCount = Math.max(1, Math.floor(durationUs / frameIntervalUs));
    for (let index = 0; index < frameCount; index++) {
      if (signal?.aborted) break;
      await sleep(frameIntervalUs / 1_000);
      context.drawImage(element, 0, 0, width, height);
      const bitmap = await createImageBitmap(canvas);
      const videoFrame = new VideoFrame(bitmap, {
        timestamp: index * frameIntervalUs,
        duration: frameIntervalUs,
      });
      bitmap.close();
      const decoded = await copyVideoFrame(videoFrame, `${trackId}:${index}`, 'I420');
      decoded.ptsUs = index * frameIntervalUs;
      decoded.durationUs = frameIntervalUs;
      frames.push(decoded);
      videoFrame.close();
    }
    element.srcObject = null;
  }

  if (frames.length === 0) {
    throw new Error('DeviceCapture: no video frames were captured');
  }

  const videoTrack: VideoMediaTrack = {
    trackId,
    index: 0,
    kind: 'video',
    codec: 'Raw',
    codecFamily: 'unknown',
    codecConfig: null,
    timeBase: { numerator: 1, denominator: 1_000_000 },
    durationUs,
    sampleCount: frames.length,
    width,
    height,
    frameRate: Math.round(frames.length / (durationUs / 1_000_000)),
    metadata: { captureRole: 'camera' },
  };

  return {
    track: videoTrack,
    clip: {
      requestId: `${trackId}:capture`,
      backend: CAPTURE_BACKEND,
      frames,
      diagnostics: [],
    },
  };
}

export async function captureAudioTrack(
  stream: MediaStream,
  role: CaptureTrackRole,
  durationUs: number,
  signal?: AbortSignal,
): Promise<{ clip: PcmAudioClip; track: AudioMediaTrack }> {
  const mediaTrack = stream.getAudioTracks()[0];
  if (!mediaTrack) throw new Error(`DeviceCapture: ${role} stream has no audio track`);

  const audioContext = new AudioContext();
  try {
    await audioContext.resume();
    if (typeof audioContext.audioWorklet?.addModule !== 'function') {
      throw new Error('DeviceCapture: AudioWorklet is required (ScriptProcessorNode is not supported)');
    }

    const blob = new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await audioContext.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    const sourceNode = audioContext.createMediaStreamSource(stream);
    const channels = Math.max(1, Math.min(2, mediaTrack.getSettings().channelCount ?? 1));
    const sampleRate = audioContext.sampleRate;
    const totalSamples = Math.ceil((durationUs / 1_000_000) * sampleRate);
    const channelChunks = Array.from({ length: channels }, () => [] as Float32Array[]);

    const worklet = new AudioWorkletNode(audioContext, CAPTURE_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [channels],
      channelCount: channels,
      channelCountMode: 'explicit',
    });

    const done = new Promise<void>((resolve, reject) => {
      worklet.port.onmessage = event => {
        const data = event.data;
        if (!data || data.type !== 'chunk') return;
        const planes = data.planes as Float32Array[];
        for (let channel = 0; channel < channels; channel++) {
          const plane = planes[Math.min(channel, planes.length - 1)];
          if (plane) channelChunks[channel]!.push(plane);
        }
      };
      worklet.onprocessorerror = () => {
        reject(new Error(`DeviceCapture: ${role} AudioWorklet failed`));
      };
      const timer = window.setTimeout(() => resolve(), durationUs / 1_000);
      signal?.addEventListener('abort', () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
    });

    const mute = audioContext.createGain();
    mute.gain.value = 0;
    sourceNode.connect(worklet);
    worklet.connect(mute);
    mute.connect(audioContext.destination);
    await done;
    worklet.port.postMessage({ type: 'stop' });
    worklet.port.onmessage = null;
    worklet.disconnect();
    sourceNode.disconnect();
    mute.disconnect();

    const planes = channelChunks.map(chunks => concatFloat32(chunks, totalSamples));
    const sampleCount = planes[0]?.length ?? 0;
    const trackId = role === 'speaker' ? 'capture:speaker:0' : 'capture:microphone:0';
    const audioTrack: AudioMediaTrack = {
      trackId,
      index: role === 'speaker' ? 2 : 1,
      kind: 'audio',
      codec: 'PCM',
      codecFamily: 'pcm',
      codecConfig: null,
      timeBase: { numerator: 1, denominator: sampleRate },
      durationUs: Math.round((sampleCount / sampleRate) * 1_000_000),
      sampleCount,
      sampleRate,
      channels,
      metadata: { captureRole: role },
    };

    return {
      track: audioTrack,
      clip: {
        clipId: `${trackId}:capture`,
        sourceTrackId: trackId,
        ptsUs: 0,
        durationUs: audioTrack.durationUs ?? durationUs,
        sampleRate,
        channels,
        sampleCount,
        format: 'f32-planar',
        planes,
        backend: WEBCODECS_AAC_BACKEND,
        diagnostics: [],
      },
    };
  } finally {
    await audioContext.close();
  }
}

function applyCapturedAudioSampleRate(
  captured: { clip: PcmAudioClip; track: AudioMediaTrack } | undefined,
  targetSampleRate?: number,
): { clip: PcmAudioClip; track: AudioMediaTrack } | undefined {
  if (!captured) return undefined;

  const rate = Math.floor(Number(targetSampleRate ?? 0));
  if (!Number.isFinite(rate) || rate <= 0 || captured.clip.sampleRate === rate) {
    return captured;
  }

  const clip = resamplePcmClip(captured.clip, { sampleRate: rate });
  return {
    clip,
    track: {
      ...captured.track,
      sampleRate: rate,
      sampleCount: clip.sampleCount,
      durationUs: clip.durationUs,
      timeBase: { numerator: 1, denominator: rate },
    },
  };
}

function concatFloat32(chunks: Float32Array[], maxLength: number): Float32Array {
  const total = Math.min(maxLength, chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= total) break;
    const slice = chunk.subarray(0, total - offset);
    merged.set(slice, offset);
    offset += slice.length;
  }
  return merged;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

import type { NodeDefinition } from '@media-workflow/core';
import { captureFromDevices, isBrowserCaptureAvailable } from '@media-workflow/codec';

export const deviceCaptureNode: NodeDefinition<
  Record<string, never>,
  {
    video: 'decoded_video';
    videoSelection: 'media_selection';
    microphone: 'pcm_audio';
    micSelection: 'media_selection';
    speaker: 'pcm_audio';
    speakerSelection: 'media_selection';
  }
> = {
  id: 'device_capture',
  category: 'source',
  displayName: 'Device Capture',
  description:
    'Capture camera, microphone, and system/tab speaker audio. Audio can be resampled via sampleRate (0 = device native).',
  inputs: {},
  outputs: {
    video: { type: 'decoded_video', label: 'Camera Video' },
    videoSelection: { type: 'media_selection', label: 'Video Selection' },
    microphone: { type: 'pcm_audio', label: 'Microphone PCM' },
    micSelection: { type: 'media_selection', label: 'Mic Selection' },
    speaker: { type: 'pcm_audio', label: 'Speaker PCM' },
    speakerSelection: { type: 'media_selection', label: 'Speaker Selection' },
  },
  params: {
    durationSeconds: {
      name: 'durationSeconds',
      type: 'number',
      default: 5,
      min: 0.5,
      max: 300,
      step: 0.5,
    },
    enableVideo: { name: 'enableVideo', type: 'boolean', default: true },
    enableMicrophone: { name: 'enableMicrophone', type: 'boolean', default: true },
    enableSpeaker: { name: 'enableSpeaker', type: 'boolean', default: false },
    videoDeviceId: { name: 'videoDeviceId', type: 'string', default: '' },
    audioDeviceId: { name: 'audioDeviceId', type: 'string', default: '' },
    width: { name: 'width', type: 'number', default: 640, min: 160, step: 16 },
    height: { name: 'height', type: 'number', default: 480, min: 120, step: 16 },
    frameRate: { name: 'frameRate', type: 'number', default: 30, min: 1, max: 60, step: 1 },
    sampleRate: {
      name: 'sampleRate',
      type: 'number',
      default: 48_000,
      min: 0,
      step: 1_000,
    },
  },
  async execute(ctx, { params }) {
    if (!isBrowserCaptureAvailable()) {
      throw new Error('DeviceCapture: browser MediaDevices API is required');
    }

    const result = await captureFromDevices({
      durationSeconds: Number(params.durationSeconds) || 5,
      enableVideo: Boolean(params.enableVideo ?? true),
      enableMicrophone: Boolean(params.enableMicrophone ?? true),
      enableSpeaker: Boolean(params.enableSpeaker ?? false),
      videoDeviceId: String(params.videoDeviceId ?? '').trim() || undefined,
      audioDeviceId: String(params.audioDeviceId ?? '').trim() || undefined,
      width: Number(params.width) || 640,
      height: Number(params.height) || 480,
      frameRate: Number(params.frameRate) || 30,
      sampleRate: Number(params.sampleRate) || 0,
      signal: ctx.signal,
    });

    const outputs: Partial<Record<string, unknown>> = {};
    if (result.video) outputs.video = result.video;
    if (result.videoSelection) outputs.videoSelection = result.videoSelection;
    if (result.microphone) outputs.microphone = result.microphone;
    if (result.micSelection) outputs.micSelection = result.micSelection;
    if (result.speaker) outputs.speaker = result.speaker;
    if (result.speakerSelection) outputs.speakerSelection = result.speakerSelection;

    if (Object.keys(outputs).length === 0) {
      throw new Error('DeviceCapture: no media was captured with the current settings');
    }

    ctx.log.info(
      `DeviceCapture: ${result.video?.frames.length ?? 0} video frame(s), `
      + `${result.microphone ? 'mic' : ''}${result.microphone && result.speaker ? '+' : ''}`
      + `${result.speaker ? 'speaker' : ''} audio`,
    );

    return outputs as never;
  },
};

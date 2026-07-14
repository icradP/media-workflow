import type {
  ControlHandle,
  LiveStreamHandle,
  MediaAsset,
  MediaFile,
  MediaSelection,
  NodeDefinition,
  WebAudioHandle,
} from '@media-workflow/core';
import { remuxMediaAssetToMp4, remuxMediaSelectionsToMp4 } from '@media-workflow/codec';

export const mp4MuxerNode: NodeDefinition<
  {
    video: 'media_selection';
    audio: 'media_selection';
    asset: 'media_asset';
    videoStream: 'live_stream';
    audioStream: 'live_stream';
    audioIn: 'webaudio';
    recordStart: 'control';
    recordStop: 'control';
  },
  { file: 'media_file' }
> = {
  id: 'mp4_muxer',
  category: 'transform',
  displayName: 'MP4 Muxer',
  description:
    'Batch: remux H.264/AAC selections into MP4. '
    + 'Live: streams + optional webaudio; recordStart / recordStop 任意脉冲即开录/停录（门控）。',
  inputs: {
    video: { type: 'media_selection', label: 'Video Selection', optional: true },
    audio: { type: 'media_selection', label: 'Audio Selection', optional: true },
    asset: { type: 'media_asset', label: 'Media Asset (fallback)', optional: true },
    videoStream: { type: 'live_stream', label: 'Live Video Stream', optional: true },
    audioStream: { type: 'live_stream', label: 'Live Audio Stream', optional: true },
    audioIn: { type: 'webaudio', label: 'Live Audio (processed)', optional: true },
    recordStart: { type: 'control', label: 'Record Start', optional: true },
    recordStop: { type: 'control', label: 'Record Stop', optional: true },
  },
  outputs: {
    file: { type: 'media_file', label: 'MP4 File' },
  },
  params: {
    fileName: { name: 'fileName', type: 'string', default: 'output.mp4' },
    includeVideo: { name: 'includeVideo', type: 'boolean', default: true },
    includeAudio: { name: 'includeAudio', type: 'boolean', default: true },
    videoTrackIndex: { name: 'videoTrackIndex', type: 'number', default: 0, min: 0, step: 1 },
    audioTrackIndex: { name: 'audioTrackIndex', type: 'number', default: 0, min: 0, step: 1 },
    startTimeSeconds: {
      name: 'startTimeSeconds',
      type: 'number',
      default: 0,
      min: 0,
      step: 0.001,
    },
    endTimeSeconds: {
      name: 'endTimeSeconds',
      type: 'number',
      default: -1,
      min: -1,
      step: 0.001,
    },
    alignMode: {
      name: 'alignMode',
      type: 'enum',
      default: 'trim_to_video',
      values: ['none', 'trim_to_video', 'trim_to_audio'],
    },
    videoBitrate: {
      name: 'videoBitrate',
      type: 'number',
      default: 2_000_000,
      min: 250_000,
      step: 50_000,
    },
    audioBitrate: {
      name: 'audioBitrate',
      type: 'number',
      default: 128_000,
      min: 32_000,
      step: 8_000,
    },
  },
  async execute(ctx, { inputs, params }) {
    const video = inputs.video as MediaSelection | undefined;
    const audio = inputs.audio as MediaSelection | undefined;
    const asset = inputs.asset as MediaAsset | undefined;
    const videoStream = inputs.videoStream as LiveStreamHandle | undefined;
    const audioStream = inputs.audioStream as LiveStreamHandle | undefined;
    const audioIn = inputs.audioIn as WebAudioHandle | undefined;
    const recordStart = inputs.recordStart as ControlHandle | undefined;
    const recordStop = inputs.recordStop as ControlHandle | undefined;

    if (!video && !audio && !asset) {
      if (videoStream || audioStream || audioIn || recordStart || recordStop) {
        throw new Error(
          'Mp4Muxer: Live streams + recordStart/Stop are session-driven — '
          + 'use Live Play + Trigger pulses (batch「运行」needs media_selection/asset).',
        );
      }
      throw new Error('Mp4Muxer: connect video/audio selections, a media asset, or Live streams + triggers');
    }

    const endTimeSeconds = optionalSeconds(params.endTimeSeconds);
    const result = video || audio
      ? remuxMediaSelectionsToMp4({
        video,
        audio,
        align: String(params.alignMode ?? 'trim_to_video') as never,
      })
      : remuxMediaAssetToMp4(asset!, {
        includeVideo: Boolean(params.includeVideo ?? true),
        includeAudio: Boolean(params.includeAudio ?? true),
        videoTrackIndex: Number(params.videoTrackIndex ?? 0),
        audioTrackIndex: Number(params.audioTrackIndex ?? 0),
        startTimeUs: Math.max(0, Number(params.startTimeSeconds) || 0) * 1_000_000,
        endTimeUs: endTimeSeconds === undefined
          ? undefined
          : endTimeSeconds * 1_000_000,
      });

    const fileName = String(params.fileName || 'output.mp4');
    const sourceFormat = video?.selectedTrack.asset.container.format ??
      audio?.selectedTrack.asset.container.format ??
      asset?.container.format ??
      'unknown';

    ctx.log.info(
      `Mp4Muxer: ${result.data.byteLength} bytes · video ${result.videoSampleCount} · audio ${result.audioSampleCount}`,
    );
    return {
      file: {
        fileName,
        mimeType: 'video/mp4',
        extension: 'mp4',
        data: result.data,
        metadata: {
          durationUs: result.durationUs,
          videoSampleCount: result.videoSampleCount,
          audioSampleCount: result.audioSampleCount,
          sourceFormat,
          alignMode: String(params.alignMode ?? 'trim_to_video'),
        },
      } satisfies MediaFile,
    };
  },
};

function optionalSeconds(value: unknown): number | undefined {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

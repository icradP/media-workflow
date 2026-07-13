import type {
  MediaAsset,
  MediaFile,
  MediaSelection,
  NodeDefinition,
} from '@media-workflow/core';
import { remuxMediaAssetToMp4, remuxMediaSelectionsToMp4 } from '@media-workflow/codec';

export const mp4MuxerNode: NodeDefinition<
  {
    video: 'media_selection';
    audio: 'media_selection';
    asset: 'media_asset';
  },
  { file: 'media_file' }
> = {
  id: 'mp4_muxer',
  category: 'transform',
  displayName: 'MP4 Muxer',
  description: 'Remux selected H.264/AAC samples or an analyzed asset into an MP4 file.',
  inputs: {
    video: { type: 'media_selection', label: 'Video Selection', optional: true },
    audio: { type: 'media_selection', label: 'Audio Selection', optional: true },
    asset: { type: 'media_asset', label: 'Media Asset (fallback)', optional: true },
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
  },
  async execute(ctx, { inputs, params }) {
    const video = inputs.video as MediaSelection | undefined;
    const audio = inputs.audio as MediaSelection | undefined;
    const asset = inputs.asset as MediaAsset | undefined;

    if (!video && !audio && !asset) {
      throw new Error('Mp4Muxer: connect video/audio selections or a media asset');
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

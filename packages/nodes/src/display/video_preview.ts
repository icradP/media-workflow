import type {
  DecodedVideoClip,
  LiveStreamHandle,
  NodeDefinition,
} from '@media-workflow/core';
import { packI420Planes } from '@media-workflow/codec';
import { pickDecodedFrame } from '../decode/frame_pick.js';

export const videoPreviewNode: NodeDefinition<
  { video: 'decoded_video'; stream: 'live_stream' },
  { preview: 'string' }
> = {
  id: 'video_preview',
  category: 'inspect',
  displayName: 'Video Preview',
  description:
    'WebGPU canvas preview for decoded frames. Scrub via frameIndex after Run; '
    + 'Live Play reads ring_buffer_source live_stream (packet clock + decoded sidecar).',
  inputs: {
    video: { type: 'decoded_video', label: 'Decoded Video', optional: true },
    stream: { type: 'live_stream', label: 'Live Stream', optional: true },
  },
  outputs: {
    preview: { type: 'string', label: 'Preview Metadata' },
  },
  params: {
    frameIndex: { name: 'frameIndex', type: 'number', default: 0, min: 0, step: 1 },
    continuous: { name: 'continuous', type: 'boolean', default: true },
  },
  cachePolicy: 'never',
  async execute(ctx, { inputs, params }) {
    const video = inputs.video as DecodedVideoClip | undefined;
    const stream = inputs.stream as LiveStreamHandle | undefined;

    if (video) {
      const frame = pickDecodedFrame(video, {
        mode: 'index',
        index: Number(params.frameIndex),
      });
      const packed = packI420Planes(frame);
      ctx.log.info(
        `VideoPreview: frame ${Math.max(0, Math.floor(Number(params.frameIndex) || 0)) + 1}/${video.frames.length}`
        + (stream ? ' · live_stream attached' : ''),
      );
      return {
        preview: JSON.stringify({
          mode: stream ? 'batch+live' : 'batch',
          backend: 'webgpu',
          sourceSampleId: frame.sourceSampleId,
          ptsUs: frame.ptsUs,
          displayWidth: frame.displayWidth,
          displayHeight: frame.displayHeight,
          format: frame.format,
          strides: frame.strides,
          byteLength: packed.byteLength,
          colorSpace: frame.colorSpace,
          frameCount: video.frames.length,
          continuous: Boolean(params.continuous),
          liveStreamId: stream?.streamId,
          hasVideo: stream?.hasVideo,
        }),
      };
    }

    if (stream) {
      ctx.log.info(`VideoPreview: live-only · ${stream.streamId} (Live Play draws)`);
      return {
        preview: JSON.stringify({
          mode: 'live-only',
          backend: 'webgpu',
          liveStreamId: stream.streamId,
          hasVideo: Boolean(stream.hasVideo),
          continuous: Boolean(params.continuous),
          ring: stream.ring ?? null,
        }),
      };
    }

    throw new Error(
      'VideoPreview: connect decoded_video (batch scrub) and/or live_stream (Live Play)',
    );
  },
};

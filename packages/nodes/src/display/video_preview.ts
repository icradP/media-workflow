import type { DecodedVideoClip, NodeDefinition } from '@media-workflow/core';
import { packI420Planes } from '@media-workflow/codec';
import { pickDecodedFrame } from '../decode/frame_pick.js';

export const videoPreviewNode: NodeDefinition<
  { video: 'decoded_video' },
  { preview: 'string' }
> = {
  id: 'video_preview',
  category: 'inspect',
  displayName: 'Video Preview',
  description: 'Preview and scrub decoded video frames.',
  inputs: {
    video: { type: 'decoded_video', label: 'Decoded Video' },
  },
  outputs: {
    preview: { type: 'string', label: 'Preview Metadata' },
  },
  params: {
    frameIndex: { name: 'frameIndex', type: 'number', default: 0, min: 0, step: 1 },
  },
  async execute(ctx, { inputs, params }) {
    const video = inputs.video as DecodedVideoClip | undefined;
    if (!video) throw new Error('VideoPreview: decoded video is required');
    const frame = pickDecodedFrame(video, {
      mode: 'index',
      index: Number(params.frameIndex),
    });
    const packed = packI420Planes(frame);

    ctx.log.info(
      `VideoPreview: frame ${Math.max(0, Math.floor(Number(params.frameIndex) || 0)) + 1}/${video.frames.length}`,
    );
    return {
      preview: JSON.stringify({
        sourceSampleId: frame.sourceSampleId,
        ptsUs: frame.ptsUs,
        displayWidth: frame.displayWidth,
        displayHeight: frame.displayHeight,
        format: frame.format,
        strides: frame.strides,
        byteLength: packed.byteLength,
        colorSpace: frame.colorSpace,
        frameCount: video.frames.length,
      }),
    };
  },
};

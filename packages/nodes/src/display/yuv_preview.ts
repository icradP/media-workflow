import type { DecodedVideoFrame, NodeDefinition } from '@media-workflow/core';
import { packI420Planes } from '@media-workflow/codec';

export const yuvPreviewNode: NodeDefinition<
  { frame: 'video_frame' },
  { preview: 'string' }
> = {
  id: 'yuv_preview',
  category: 'display',
  displayName: 'YUV Preview',
  description: 'Prepare decoded YUV frame metadata for canvas preview.',
  inputs: {
    frame: { type: 'video_frame', label: 'Decoded Frame' },
  },
  outputs: {
    preview: { type: 'string', label: 'Preview Payload' },
  },
  async execute(ctx, { inputs }) {
    const frame = inputs.frame as DecodedVideoFrame | undefined;
    if (!frame) throw new Error('YuvPreview: decoded frame is required');

    const packed = packI420Planes(frame);
    ctx.log.info(`YuvPreview: ${frame.displayWidth}x${frame.displayHeight} ${frame.format}`);
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
      }),
    };
  },
};

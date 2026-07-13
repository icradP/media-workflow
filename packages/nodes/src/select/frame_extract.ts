import type { DecodedVideoClip, NodeDefinition } from '@media-workflow/core';
import { pickDecodedFrame } from '../decode/frame_pick.js';

export const frameExtractNode: NodeDefinition<
  { video: 'decoded_video' },
  { frame: 'video_frame' }
> = {
  id: 'frame_extract',
  category: 'transform',
  displayName: 'Frame Extract',
  description: 'Extract one decoded frame for frame-level processing.',
  inputs: {
    video: { type: 'decoded_video', label: 'Decoded Video' },
  },
  outputs: {
    frame: { type: 'video_frame', label: 'Decoded Frame' },
  },
  params: {
    mode: {
      name: 'mode',
      type: 'enum',
      default: 'first',
      values: ['first', 'index', 'sample_id', 'pts'],
    },
    index: { name: 'index', type: 'number', default: 0, min: 0, step: 1 },
    sampleId: { name: 'sampleId', type: 'string', default: '' },
    ptsSeconds: { name: 'ptsSeconds', type: 'number', default: 0, min: 0, step: 0.001 },
  },
  async execute(ctx, { inputs, params }) {
    const video = inputs.video as DecodedVideoClip | undefined;
    if (!video) throw new Error('FrameExtract: decoded video is required');

    const frame = pickDecodedFrame(video, {
      mode: String(params.mode) as never,
      index: Number(params.index),
      sampleId: String(params.sampleId ?? ''),
      ptsUs: Math.round((Number(params.ptsSeconds) || 0) * 1_000_000),
    });
    ctx.log.info(`FrameExtract: ${frame.sourceSampleId} @ ${frame.ptsUs} us`);
    return { frame };
  },
};

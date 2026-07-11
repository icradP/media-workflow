import type {
  DecodedVideoFrame,
  DecodedVideoFrameSet,
  NodeDefinition,
} from '@media-workflow/core';

export const decodedFrameSelectorNode: NodeDefinition<
  { frames: 'decoded_video_frames' },
  { frame: 'video_frame' }
> = {
  id: 'decoded_frame_selector',
  category: 'utility',
  displayName: 'Decoded Frame Selector',
  description: 'Select one decoded video frame from a decoded frame set.',
  inputs: {
    frames: { type: 'decoded_video_frames', label: 'Decoded Frames' },
  },
  outputs: {
    frame: { type: 'video_frame', label: 'Selected Frame' },
  },
  params: {
    selection: {
      name: 'selection',
      type: 'enum',
      default: 'first',
      values: ['first', 'sample_id', 'pts'],
    },
    sampleId: { name: 'sampleId', type: 'string', default: '' },
    ptsSeconds: { name: 'ptsSeconds', type: 'number', default: 0, min: 0, step: 0.001 },
  },
  async execute(ctx, { inputs, params }) {
    const frameSet = inputs.frames as DecodedVideoFrameSet | undefined;
    if (!frameSet) throw new Error('DecodedFrameSelector: decoded frame set is required');
    if (frameSet.frames.length === 0) {
      throw new Error('DecodedFrameSelector: decoded frame set is empty');
    }

    const selection = String(params.selection ?? 'first');
    let frame: DecodedVideoFrame | undefined;

    if (selection === 'sample_id') {
      const sampleId = String(params.sampleId ?? '');
      frame = frameSet.frames.find(candidate => candidate.sourceSampleId === sampleId);
      if (!frame) {
        throw new Error(`DecodedFrameSelector: no frame for sample ${sampleId}`);
      }
    } else if (selection === 'pts') {
      const targetPtsUs = Math.round((Number(params.ptsSeconds) || 0) * 1_000_000);
      frame = frameSet.frames.find(candidate => candidate.ptsUs === targetPtsUs);
      if (!frame) {
        throw new Error(`DecodedFrameSelector: no frame at PTS ${targetPtsUs} us`);
      }
    } else {
      frame = frameSet.frames[0];
    }

    ctx.log.info(`DecodedFrameSelector: ${frame!.sourceSampleId} @ ${frame!.ptsUs} us`);
    return { frame: frame! };
  },
};

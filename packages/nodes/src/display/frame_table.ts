import type { NodeDefinition } from '@media-workflow/core';
import type { MediaAsset, MediaSample } from '@media-workflow/core';

/**
 * FrameTable — 从解析结果提取帧列表，供 UI viewport 渲染表格。
 *
 * Inputs:  media
 * Outputs: frames
 */
export const frameTableNode: NodeDefinition<
  { asset: 'media_asset'; samples: 'media_samples' },
  { samples: 'media_samples' }
> = {
  id: 'frame_table',
  category: 'display',
  displayName: 'Frame Table',
  description: 'Display frame metadata as an interactive table.',
  inputs: {
    asset: { type: 'media_asset', label: 'Media Asset', optional: true },
    samples: { type: 'media_samples', label: 'Selected Frames', optional: true },
  },
  outputs: {
    samples: { type: 'media_samples', label: 'Samples' },
  },
  params: {
    trackId: { name: 'trackId', type: 'string', default: '' },
  },
  async execute(ctx, { inputs, params }) {
    const asset = inputs.asset as MediaAsset | undefined;
    const selectedSamples = inputs.samples as MediaSample[] | undefined;
    if (!asset && !selectedSamples) {
      throw new Error('FrameTable: connect a media asset or selected frames');
    }
    const trackId = String(params.trackId ?? '').trim();
    const sourceSamples = selectedSamples ?? asset?.samples ?? [];
    const samples = trackId
      ? sourceSamples.filter(sample => sample.trackId === trackId)
      : sourceSamples;
    ctx.log.info(`FrameTable: ${samples.length} samples`);
    return { samples };
  },
};

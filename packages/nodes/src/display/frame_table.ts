import type { MediaSelection, NodeDefinition } from '@media-workflow/core';

/**
 * FrameTable — 从解析结果提取帧列表，供 UI viewport 渲染表格。
 *
 * Inputs:  media
 * Outputs: frames
 */
export const frameTableNode: NodeDefinition<
  { selection: 'media_selection' },
  { selection: 'media_selection' }
> = {
  id: 'sample_table',
  category: 'inspect',
  displayName: 'Frame Table',
  description: 'Display frame metadata as an interactive table.',
  inputs: {
    selection: { type: 'media_selection', label: 'Media Selection' },
  },
  outputs: {
    selection: { type: 'media_selection', label: 'Selection' },
  },
  async execute(ctx, { inputs }) {
    const selection = inputs.selection as MediaSelection | undefined;
    if (!selection) throw new Error('SampleTable: media selection is required');
    ctx.log.info(`SampleTable: ${selection.samples.length} samples`);
    return { selection };
  },
};

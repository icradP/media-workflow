import type { NodeDefinition } from '@media-workflow/core';
import type { MediaSource } from '@media-workflow/core';
import { analyzeMediaSource } from '@media-workflow/codec';

/**
 * AutoDetectParser — 自动识别容器格式并解析。
 *
 * Inputs:  buffer
 * Outputs: media
 */
export const autoAnalyzeNode: NodeDefinition<
  { source: 'media_source' },
  { asset: 'media_asset'; probe: 'media_probe' }
> = {
  id: 'auto_analyze',
  category: 'analyze',
  displayName: 'Auto Analyze',
  description: 'Probe the container and normalize tracks and samples into a MediaAsset.',
  inputs: {
    source: { type: 'media_source', label: 'Media Source' },
  },
  outputs: {
    asset: { type: 'media_asset', label: 'Media Asset' },
    probe: { type: 'media_probe', label: 'Probe Result' },
  },
  async execute(ctx, { inputs }) {
    const source = inputs.source as MediaSource | undefined;
    if (!source) throw new Error('AutoAnalyze: no media source');

    const asset = analyzeMediaSource(source);

    ctx.log.info(
      `AutoAnalyze: ${asset.container.format}, ${asset.samples.length} samples, ${asset.tracks.length} tracks`,
    );

    return { asset, probe: asset.probe };
  },
};

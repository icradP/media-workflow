import type { NodeDefinition } from '@media-workflow/core';
import { fileLoaderNode } from './source/file_loader.js';
import { urlFetcherNode } from './source/url_fetcher.js';
import { autoAnalyzeNode } from './parser/auto_detect.js';
import { trackSelectNode } from './select/track_select.js';
import { mediaSelectNode } from './select/media_select.js';
import { frameExtractNode } from './select/frame_extract.js';
import { videoDecodeNode } from './decode/video_decode.js';
import { audioDecodeNode } from './decode/audio_decode.js';
import { frameTableNode } from './display/frame_table.js';
import { hexViewNode } from './display/hex_view.js';
import { videoPreviewNode } from './display/video_preview.js';
import { streamOverviewNode } from './display/stream_info.js';
import { trackDetailNode } from './display/track_detail.js';
import { wavEncoderNode } from './encoder/wav.js';
import { rawYuvExporterNode } from './export/raw_yuv.js';
import { fileExportNode } from './export/file_export.js';

export const allNodes: NodeDefinition[] = [
  fileLoaderNode,
  urlFetcherNode,
  autoAnalyzeNode,
  trackSelectNode,
  mediaSelectNode,
  videoDecodeNode,
  audioDecodeNode,
  frameExtractNode,
  frameTableNode,
  hexViewNode,
  videoPreviewNode,
  streamOverviewNode,
  trackDetailNode,
  wavEncoderNode,
  rawYuvExporterNode,
  fileExportNode,
];

export const nodeRegistry: Map<string, NodeDefinition> = new Map(
  allNodes.map(node => [node.id, node]),
);

export function nodesByCategory(): Map<string, NodeDefinition[]> {
  const map = new Map<string, NodeDefinition[]>();
  for (const node of allNodes) {
    const group = map.get(node.category);
    if (group) group.push(node);
    else map.set(node.category, [node]);
  }
  return map;
}

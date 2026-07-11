import type { NodeDefinition } from '@media-workflow/core';
import { fileLoaderNode } from './source/file_loader.js';
import { urlFetcherNode } from './source/url_fetcher.js';
import { autoAnalyzeNode } from './parser/auto_detect.js';
import { trackSelectorNode } from './utility/track_selector.js';
import { frameSelectorNode } from './utility/frame_selector.js';
import { decodedFrameSelectorNode } from './utility/decoded_frame_selector.js';
import { videoFrameRequestNode } from './planner/video_frame_request.js';
import { audioRangeRequestNode } from './planner/audio_range_request.js';
import { webcodecsVideoDecoderNode } from './decoder/webcodecs_video.js';
import { webcodecsAudioDecoderNode } from './decoder/webcodecs_audio.js';
import { g711DecoderNode } from './decoder/g711.js';
import { frameTableNode } from './display/frame_table.js';
import { hexViewNode } from './display/hex_view.js';
import { yuvPreviewNode } from './display/yuv_preview.js';
import { streamOverviewNode } from './display/stream_info.js';
import { trackDetailNode } from './display/track_detail.js';
import { wavEncoderNode } from './encoder/wav.js';
import { rawYuvExporterNode } from './export/raw_yuv.js';
import { fileExportNode } from './export/file_export.js';

export const allNodes: NodeDefinition[] = [
  fileLoaderNode,
  urlFetcherNode,
  autoAnalyzeNode,
  trackSelectorNode,
  frameSelectorNode,
  decodedFrameSelectorNode,
  videoFrameRequestNode,
  audioRangeRequestNode,
  webcodecsVideoDecoderNode,
  webcodecsAudioDecoderNode,
  g711DecoderNode,
  frameTableNode,
  hexViewNode,
  yuvPreviewNode,
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

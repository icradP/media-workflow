/**
 * @media-workflow/nodes — 工作流节点注册表
 *
 * 所有可用节点的集中注册。UI 层从此处加载节点列表。
 */

import type { NodeDefinition } from '@media-workflow/core';

// ─── Source ───
import { fileLoaderNode } from './source/file_loader.js';
import { urlFetcherNode } from './source/url_fetcher.js';

// ─── Parser ───
import { autoAnalyzeNode } from './parser/auto_detect.js';

// ─── Utility ───
import { trackSelectorNode } from './utility/track_selector.js';
import { frameSelectorNode } from './utility/frame_selector.js';

// ─── Display ───
import { frameTableNode } from './display/frame_table.js';
import { hexViewNode } from './display/hex_view.js';
import { streamOverviewNode } from './display/stream_info.js';
import { trackDetailNode } from './display/track_detail.js';

export { mediaSourceFromFile } from './source/file_loader.js';

/** 所有已注册节点 */
export const allNodes: NodeDefinition[] = [
  fileLoaderNode,
  urlFetcherNode,
  autoAnalyzeNode,
  trackSelectorNode,
  frameSelectorNode,
  frameTableNode,
  hexViewNode,
  streamOverviewNode,
  trackDetailNode,
];

/** 按 ID 索引的注册表 */
export const nodeRegistry: Map<string, NodeDefinition> = new Map(
  allNodes.map(n => [n.id, n]),
);

/** 按 category 分组 */
export function nodesByCategory(): Map<string, NodeDefinition[]> {
  const map = new Map<string, NodeDefinition[]>();
  for (const node of allNodes) {
    const group = map.get(node.category);
    if (group) {
      group.push(node);
    } else {
      map.set(node.category, [node]);
    }
  }
  return map;
}

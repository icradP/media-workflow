/**
 * Worker 入口 — 在 Web Worker 中执行节点
 *
 * 主线程发来 { type: 'execute', nodeId, inputs, params } 消息，
 * Worker 动态 import 对应节点模块 → 调 execute() → postMessage 回结果。
 */

import { nodeRegistry } from '@media-workflow/nodes';
import { createContext } from '@media-workflow/core';
import { extractTransferablesFromDecodedOutput } from '@media-workflow/core/decoder';

self.onmessage = async (event: MessageEvent) => {
  const { type, nodeId, inputs, params } = event.data;

  if (type !== 'execute') return;

  const node = nodeRegistry.get(nodeId);
  if (!node) {
    self.postMessage({ type: 'error', error: `Node not found: ${nodeId}` });
    return;
  }

  const ctx = createContext(new AbortController().signal);

  try {
    const rawResult = await node.execute(ctx, { inputs: inputs as never, params });
    const outputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawResult)) {
      outputs[key] = value;
    }
    // 将 Transferable 对象 (ArrayBuffer 等) 传回主线程
    const transferables = extractTransferablesFromDecodedOutput(outputs);
    self.postMessage({ type: 'result', nodeId, outputs }, { transfer: transferables });
  } catch (err) {
    self.postMessage({ type: 'error', nodeId, error: String(err) });
  }
};

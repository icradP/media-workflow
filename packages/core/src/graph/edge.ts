import type { NodeOutput } from '../types/node';
import type { PinType } from '../types/pins';

export const BYTE_PRODUCING_PIN_TYPES: ReadonlySet<PinType> = new Set([
  'buffer',
  'media_source',
  'media_asset',
  'media_samples',
  'compressed',
  'encoded_packets',
  'decoded_video_frames',
  'video_frame',
  'pcm_audio',
  'encoded_track',
  'media_file',
  'audio_buffer',
  'nal_units',
  'sei_payload',
]);

/**
 * 图中的一条边 — 连接上游节点的某个输出到下游节点的某个输入
 */
export interface Edge {
  id: string;
  /** 上游节点 ID */
  sourceNodeId: string;
  /** 上游节点的输出 Pin 名称 */
  sourceOutput: string;
  /** 下游节点 ID */
  targetNodeId: string;
  /** 下游节点的输入 Pin 名称 */
  targetInput: string;
}

/**
 * 校验两个 PinType 是否兼容连接。
 *
 * 规则：
 *  - 同类型 → OK
 *  - 未来可扩展：某些类型之间存在隐式转换 (e.g. 'media' 包含 'stream')
 */
export function arePinTypesCompatible(source: PinType, target: PinType): boolean {
  return source === target ||
    (target === 'byte_data' && BYTE_PRODUCING_PIN_TYPES.has(source));
}

/**
 * 检查一条边是否有效（节点存在、Pin 名称匹配、类型兼容）。
 *
 * @returns null 表示有效，否则返回错误消息。
 */
export function validateEdge(
  edge: Edge,
  sourceOutputs: Map<string, Map<string, NodeOutput>>, // nodeId → outputName → NodeOutput
  targetInputs: Map<string, Map<string, NodeOutput>>,   // nodeId → inputName → NodeInput
): string | null {
  const srcOuts = sourceOutputs.get(edge.sourceNodeId);
  if (!srcOuts) return `Source node not found: ${edge.sourceNodeId}`;

  const srcPin = srcOuts.get(edge.sourceOutput);
  if (!srcPin) return `Source output not found: ${edge.sourceNodeId}.${edge.sourceOutput}`;

  const tgtIns = targetInputs.get(edge.targetNodeId);
  if (!tgtIns) return `Target node not found: ${edge.targetNodeId}`;

  const tgtPin = tgtIns.get(edge.targetInput);
  if (!tgtPin) return `Target input not found: ${edge.targetNodeId}.${edge.targetInput}`;

  if (!arePinTypesCompatible((srcPin as NodeOutput).type, (tgtPin as NodeOutput).type)) {
    return `Type mismatch: ${(srcPin as NodeOutput).type} → ${(tgtPin as NodeOutput).type}`;
  }

  return null;
}

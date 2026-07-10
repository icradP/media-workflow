import type { NodeDefinition } from '../types/node';
import type { Edge } from './edge';

/**
 * 工作流图 — 可序列化的完整工作流定义
 */
export interface WorkflowGraph {
  /** 图的版本，用于向前兼容 */
  version: 1;
  /** 节点映射: nodeId → NodeDefinition (仅定义，不含运行时状态) */
  nodes: Map<string, NodeDefinition>;
  /** 边列表 */
  edges: Edge[];
  /** 元数据 */
  metadata?: WorkflowMetadata;
}

export interface WorkflowMetadata {
  name?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 工作流的 JSON 序列化格式。
 * Map 在 JSON 中表现为 key-value 对数组。
 */
export interface WorkflowGraphJSON {
  version: 1;
  nodes: [string, NodeDefinition][];
  edges: Edge[];
  metadata?: WorkflowMetadata;
}

/**
 * 序列化为可 JSON 持久化的对象
 */
export function graphToJSON(graph: WorkflowGraph): WorkflowGraphJSON {
  return {
    version: graph.version,
    nodes: Array.from(graph.nodes.entries()),
    edges: graph.edges,
    metadata: graph.metadata,
  };
}

/**
 * 从 JSON 反序列化
 */
export function graphFromJSON(json: WorkflowGraphJSON): WorkflowGraph {
  return {
    version: json.version,
    nodes: new Map(json.nodes),
    edges: json.edges,
    metadata: json.metadata,
  };
}

/**
 * 获取某个节点的直接后继（通过边连接的下游节点 ID 列表）
 */
export function getDirectSuccessors(graph: WorkflowGraph, nodeId: string): string[] {
  return graph.edges
    .filter(e => e.sourceNodeId === nodeId)
    .map(e => e.targetNodeId);
}

/**
 * 获取某个节点的直接前驱（通过边连接的上游节点 ID 列表）
 */
export function getDirectPredecessors(graph: WorkflowGraph, nodeId: string): string[] {
  return graph.edges
    .filter(e => e.targetNodeId === nodeId)
    .map(e => e.sourceNodeId);
}

/**
 * 构建邻接表: nodeId → 后继 nodeId[]
 */
export function buildAdjacencyList(graph: WorkflowGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const nodeId of graph.nodes.keys()) {
    adj.set(nodeId, []);
  }
  for (const edge of graph.edges) {
    const succs = adj.get(edge.sourceNodeId);
    if (succs) succs.push(edge.targetNodeId);
  }
  return adj;
}

/**
 * 构建反向邻接表: nodeId → 前驱 nodeId[]
 */
export function buildReverseAdjacencyList(graph: WorkflowGraph): Map<string, string[]> {
  const radj = new Map<string, string[]>();
  for (const nodeId of graph.nodes.keys()) {
    radj.set(nodeId, []);
  }
  for (const edge of graph.edges) {
    const preds = radj.get(edge.targetNodeId);
    if (preds) preds.push(edge.sourceNodeId);
  }
  return radj;
}

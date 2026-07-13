import type { MediaDiagnostic } from '../types/carriers.js';
import type { NodeDefinition } from '../types/node';
import type { ExecutionCache } from './cache';
import type { WorkflowGraph } from '../graph/graph';
import { buildReverseAdjacencyList } from '../graph/graph';
import {
  assertValidWorkflowGraph,
  assertWorkflowGraphStructure,
  workflowSubgraph,
} from '../graph/index.js';
import { hasCycle, topologicalLevels, affectedSubgraph } from '../graph/topo';
import { createContext } from './context';

/**
 * 执行计划 — 一个按拓扑层级排列的节点执行队列
 */
export interface ExecutionPlan {
  /** 按层级分组: levels[0] 先执行，同层可并行 */
  levels: string[][];
  /** 每个节点的前驱映射: nodeId → [前驱 nodeId] */
  predecessors: Map<string, string[]>;
  /** 每个边的映射: targetNodeId → targetInput → { sourceNodeId, sourceOutput } */
  edgeMap: Map<string, Map<string, { sourceNodeId: string; sourceOutput: string }>>;
}

export interface NodeExecutionEvent {
  nodeId: string;
  node: NodeDefinition;
  status: 'completed' | 'cached' | 'failed';
  inputs: Record<string, unknown>;
  params: Record<string, unknown>;
  outputs: Record<string, unknown>;
  durationMs: number;
  cacheHit: boolean;
  diagnostics: MediaDiagnostic[];
  error?: Error;
}

export type NodeExecutionListener = (event: NodeExecutionEvent) => void;

export interface ExecuteGraphOptions {
  /** 仅执行该集合中的节点；默认执行全图（并要求所有必填输入已连线）。 */
  runnableNodeIds?: Set<string>;
}

/**
 * 根据图构建执行计划。
 */
export function buildExecutionPlan(graph: WorkflowGraph): ExecutionPlan {
  const levels = topologicalLevels(graph);
  const predecessors = buildReverseAdjacencyList(graph);

  // 构建边映射: 下游节点 → 输入名称 → 上游节点+输出
  const edgeMap = new Map<string, Map<string, { sourceNodeId: string; sourceOutput: string }>>();
  for (const edge of graph.edges) {
    let nodeMap = edgeMap.get(edge.targetNodeId);
    if (!nodeMap) {
      nodeMap = new Map();
      edgeMap.set(edge.targetNodeId, nodeMap);
    }
    nodeMap.set(edge.targetInput, {
      sourceNodeId: edge.sourceNodeId,
      sourceOutput: edge.sourceOutput,
    });
  }

  return { levels, predecessors, edgeMap };
}

/**
 * Runtime 调度器 — 按拓扑层级执行 DAG。
 *
 * @param graph     工作流图
 * @param cache     执行缓存
 * @param signal    取消信号
 * @param onChange  节点执行完成后的回调（用于 UI 实时更新输出）
 * @returns 所有节点的最终输出: Map<nodeId, { outputName → value }>
 */
export async function executeGraph(
  graph: WorkflowGraph,
  cache: ExecutionCache,
  signal: AbortSignal,
  onEvent?: NodeExecutionListener,
  options?: ExecuteGraphOptions,
): Promise<Map<string, Map<string, unknown>>> {
  const runnableNodeIds = options?.runnableNodeIds;
  const executionGraph = runnableNodeIds
    ? workflowSubgraph(graph, runnableNodeIds)
    : graph;

  if (executionGraph.nodes.size === 0) {
    return new Map();
  }

  if (runnableNodeIds) {
    assertWorkflowGraphStructure(graph);
    if (hasCycle(executionGraph)) {
      throw new Error('Invalid workflow graph: Workflow graph contains a cycle.');
    }
  } else {
    assertValidWorkflowGraph(graph);
  }

  const plan = buildExecutionPlan(executionGraph);
  const results = new Map<string, Map<string, unknown>>();

  for (const level of plan.levels) {
    if (signal.aborted) break;

    const levelPromises = level.map(nodeId => {
      return executeNode(nodeId, executionGraph, plan, results, cache, signal, onEvent);
    });

    await Promise.all(levelPromises);
  }

  return results;
}

/**
 * 增量执行 — 只重新执行受影响的节点（dirty 节点及其下游）。
 *
 * @param graph     工作流图
 * @param dirtyIds  标记为脏的节点 ID 集合（参数变化、输入变化等）
 * @param cache     执行缓存
 * @param prevResults 上次完整执行的结果
 * @param signal    取消信号
 * @param onChange  节点执行完成回调
 * @returns 更新后的完整结果集
 */
export async function executeIncremental(
  graph: WorkflowGraph,
  dirtyIds: Set<string>,
  cache: ExecutionCache,
  prevResults: Map<string, Map<string, unknown>>,
  signal: AbortSignal,
  onEvent?: NodeExecutionListener,
): Promise<Map<string, Map<string, unknown>>> {
  assertValidWorkflowGraph(graph);
  const affected = new Set(affectedSubgraph(graph, dirtyIds));
  const plan = buildExecutionPlan(graph);

  // 复制之前的结果，仅保留未受影响的节点
  const results = new Map<string, Map<string, unknown>>();
  for (const [nodeId, outputs] of prevResults) {
    if (!affected.has(nodeId)) {
      results.set(nodeId, new Map(outputs));
    }
  }

  for (const level of plan.levels) {
    if (signal.aborted) break;

    const levelPromises = level
      .filter(id => affected.has(id))
      .map(nodeId => {
        return executeNode(nodeId, graph, plan, results, cache, signal, onEvent);
      });

    await Promise.all(levelPromises);
  }

  return results;
}

async function executeNode(
  nodeId: string,
  graph: WorkflowGraph,
  plan: ExecutionPlan,
  results: Map<string, Map<string, unknown>>,
  cache: ExecutionCache,
  signal: AbortSignal,
  onEvent?: NodeExecutionListener,
): Promise<void> {
  const node = graph.nodes.get(nodeId);
  if (!node) return;

  // 收集输入值
  const inputValues: Record<string, unknown> = {};
  const edgeMap = plan.edgeMap.get(nodeId);

  for (const [inputName, inputDef] of Object.entries(node.inputs)) {
    const edge = edgeMap?.get(inputName);
    if (edge) {
      const srcOutputs = results.get(edge.sourceNodeId);
      if (!srcOutputs?.has(edge.sourceOutput)) {
        throw new Error(
          `Upstream output ${edge.sourceNodeId}.${edge.sourceOutput} was not produced for ${nodeId}.${inputName}.`,
        );
      }
      inputValues[inputName] = srcOutputs.get(edge.sourceOutput);
    } else if (!inputDef.optional) {
      throw new Error(`Required input ${node.displayName}.${inputName} is not connected.`);
    }
  }

  // 收集参数
  const paramValues: Record<string, unknown> = {};
  if (node.params) {
    for (const [paramName, paramDef] of Object.entries(node.params)) {
      paramValues[paramName] = paramDef.default;
    }
  }

  // 检查缓存
  const shouldCache = node.cachePolicy !== 'never';
  const cached = shouldCache
    ? cache.get(nodeId, inputValues, paramValues)
    : undefined;
  if (cached) {
    const startedAt = performance.now();
    const outputs = new Map(Object.entries(cached.outputs));
    results.set(nodeId, outputs);
    onEvent?.({
      nodeId,
      node,
      status: 'cached',
      inputs: inputValues,
      params: paramValues,
      outputs: cached.outputs,
      durationMs: performance.now() - startedAt,
      cacheHit: true,
      diagnostics: collectDiagnostics(inputValues, cached.outputs),
    });
    return;
  }

  // 执行
  const ctx = createContext(signal);
  const startedAt = performance.now();
  try {
    const rawResult = await node.execute(ctx, {
      inputs: inputValues as never,
      params: paramValues,
    });

    const outputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawResult)) {
      outputs[key] = value;
    }

    results.set(nodeId, new Map(Object.entries(outputs)));
    if (shouldCache) {
      cache.set(nodeId, inputValues, paramValues, { outputs });
    }
    onEvent?.({
      nodeId,
      node,
      status: 'completed',
      inputs: inputValues,
      params: paramValues,
      outputs,
      durationMs: performance.now() - startedAt,
      cacheHit: false,
      diagnostics: collectDiagnostics(inputValues, outputs),
    });
  } catch (err) {
    ctx.log.error(`Node "${node.displayName}" (${nodeId}) execution failed:`, err);
    const error = err instanceof Error ? err : new Error(String(err));
    onEvent?.({
      nodeId,
      node,
      status: 'failed',
      inputs: inputValues,
      params: paramValues,
      outputs: {},
      durationMs: performance.now() - startedAt,
      cacheHit: false,
      diagnostics: [],
      error,
    });
    throw error;
  } finally {
    ctx.resources.disposeAll();
  }
}

function collectDiagnostics(
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>,
): MediaDiagnostic[] {
  const diagnostics: MediaDiagnostic[] = [];
  for (const value of [...Object.values(inputs), ...Object.values(outputs)]) {
    if (!value || typeof value !== 'object' || !('diagnostics' in value)) continue;
    const candidate = (value as { diagnostics?: unknown }).diagnostics;
    if (Array.isArray(candidate)) {
      diagnostics.push(...candidate.filter(isMediaDiagnostic));
    }
  }
  return diagnostics;
}

function isMediaDiagnostic(value: unknown): value is MediaDiagnostic {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MediaDiagnostic>;
  return (
    (candidate.severity === 'info' ||
      candidate.severity === 'warning' ||
      candidate.severity === 'error') &&
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string'
  );
}

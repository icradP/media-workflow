import type { WorkflowGraph } from './graph';
import { buildAdjacencyList, buildReverseAdjacencyList } from './graph';

/**
 * 拓扑排序 (Kahn's algorithm)。
 *
 * @param graph 工作流图
 * @returns 拓扑排序后的节点 ID 列表
 * @throws 如果图中存在循环
 */
export function topologicalSort(graph: WorkflowGraph): string[] {
  const adj = buildAdjacencyList(graph);
  const radj = buildReverseAdjacencyList(graph);

  // 计算入度
  const inDegree = new Map<string, number>();
  for (const nodeId of graph.nodes.keys()) {
    inDegree.set(nodeId, (radj.get(nodeId) ?? []).length);
  }

  // 入度为 0 的节点入队
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const succ of adj.get(current) ?? []) {
      const newDegree = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, newDegree);
      if (newDegree === 0) queue.push(succ);
    }
  }

  if (sorted.length !== graph.nodes.size) {
    throw new Error('Cycle detected in workflow graph — topological sort failed');
  }

  return sorted;
}

/**
 * 检测图中是否存在循环。
 */
export function hasCycle(graph: WorkflowGraph): boolean {
  try {
    topologicalSort(graph);
    return false;
  } catch {
    return true;
  }
}

/**
 * 将节点按拓扑层级分组 — 同一层级的节点可以并行执行。
 *
 * @returns 层级数组，每层是一组 nodeId（组内无依赖，可并行）
 */
export function topologicalLevels(graph: WorkflowGraph): string[][] {
  const adj = buildAdjacencyList(graph);
  const radj = buildReverseAdjacencyList(graph);

  const inDegree = new Map<string, number>();
  for (const nodeId of graph.nodes.keys()) {
    inDegree.set(nodeId, (radj.get(nodeId) ?? []).length);
  }

  const levels: string[][] = [];
  let currentLevel: string[] = [];

  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) currentLevel.push(nodeId);
  }

  let remaining = graph.nodes.size;
  while (currentLevel.length > 0) {
    levels.push(currentLevel);
    remaining -= currentLevel.length;

    const nextLevel: string[] = [];
    for (const node of currentLevel) {
      for (const succ of adj.get(node) ?? []) {
        const newDegree = (inDegree.get(succ) ?? 1) - 1;
        inDegree.set(succ, newDegree);
        if (newDegree === 0) nextLevel.push(succ);
      }
    }
    currentLevel = nextLevel;
  }

  if (remaining !== 0) {
    throw new Error('Cycle detected in workflow graph');
  }

  return levels;
}

/**
 * 计算给定一组「脏」节点后的受影响子图 — 即这些节点及其所有传递下游。
 *
 * @param graph    工作流图
 * @param dirtyIds 被标记为脏的节点 ID 集合
 * @returns 需要重新执行的所有节点 ID（按拓扑序排列）
 */
export function affectedSubgraph(graph: WorkflowGraph, dirtyIds: Set<string>): string[] {
  const adj = buildAdjacencyList(graph);
  const topo = topologicalSort(graph);

  const affected = new Set<string>(dirtyIds);

  // BFS 传播到所有下游
  const queue = [...dirtyIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const succ of adj.get(current) ?? []) {
      if (!affected.has(succ)) {
        affected.add(succ);
        queue.push(succ);
      }
    }
  }

  // 按拓扑序返回
  return topo.filter(id => affected.has(id));
}

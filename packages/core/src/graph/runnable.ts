import type { WorkflowGraph } from './graph.js';

export interface RunnableWorkflowAnalysis {
  runnableNodeIds: Set<string>;
  skippedNodeIds: Set<string>;
}

export interface AnalyzeRunnableWorkflowOptions {
  /** 用户标记为忽略执行的节点；这些节点及其依赖它们的下游都不会执行。 */
  ignoredNodeIds?: Set<string>;
}

/**
 * 找出「必填连线齐全且上游也可运行」的节点集合。
 * 未连满必填口的孤立节点不会进入该集合。
 */
export function analyzeRunnableWorkflow(
  graph: WorkflowGraph,
  options?: AnalyzeRunnableWorkflowOptions,
): RunnableWorkflowAnalysis {
  const ignoredNodeIds = options?.ignoredNodeIds ?? new Set<string>();
  const edgeMap = buildTargetInputEdgeMap(graph);
  const connectedRequiredInputs = new Set<string>();
  for (const edge of graph.edges) {
    connectedRequiredInputs.add(`${edge.targetNodeId}:${edge.targetInput}`);
  }

  const structurallyReady = new Set<string>();
  for (const [nodeId, node] of graph.nodes) {
    const hasDisconnectedRequired = Object.entries(node.inputs).some(
      ([inputName, input]) =>
        !input.optional && !connectedRequiredInputs.has(`${nodeId}:${inputName}`),
    );
    if (!hasDisconnectedRequired) {
      structurallyReady.add(nodeId);
    }
  }

  const memo = new Map<string, boolean>();
  const runnableNodeIds = new Set<string>();

  const isRunnable = (nodeId: string, visiting = new Set<string>()): boolean => {
    const cached = memo.get(nodeId);
    if (cached !== undefined) return cached;
    if (ignoredNodeIds.has(nodeId)) {
      memo.set(nodeId, false);
      return false;
    }
    if (!structurallyReady.has(nodeId)) {
      memo.set(nodeId, false);
      return false;
    }
    if (visiting.has(nodeId)) {
      memo.set(nodeId, false);
      return false;
    }

    visiting.add(nodeId);
    for (const [inputName, input] of Object.entries(graph.nodes.get(nodeId)!.inputs)) {
      if (input.optional) continue;
      const edge = edgeMap.get(nodeId)?.get(inputName);
      if (!edge) continue;
      if (!isRunnable(edge.sourceNodeId, visiting)) {
        visiting.delete(nodeId);
        memo.set(nodeId, false);
        return false;
      }
    }
    visiting.delete(nodeId);
    memo.set(nodeId, true);
    return true;
  };

  for (const nodeId of graph.nodes.keys()) {
    if (isRunnable(nodeId)) {
      runnableNodeIds.add(nodeId);
    }
  }

  const skippedNodeIds = new Set<string>();
  for (const nodeId of graph.nodes.keys()) {
    if (!runnableNodeIds.has(nodeId)) {
      skippedNodeIds.add(nodeId);
    }
  }

  return { runnableNodeIds, skippedNodeIds };
}

export function workflowSubgraph(
  graph: WorkflowGraph,
  nodeIds: Set<string>,
): WorkflowGraph {
  return {
    version: graph.version,
    nodes: new Map(
      [...graph.nodes.entries()].filter(([nodeId]) => nodeIds.has(nodeId)),
    ),
    edges: graph.edges.filter(
      edge => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
    ),
    metadata: graph.metadata,
  };
}

function buildTargetInputEdgeMap(
  graph: WorkflowGraph,
): Map<string, Map<string, { sourceNodeId: string; sourceOutput: string }>> {
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
  return edgeMap;
}

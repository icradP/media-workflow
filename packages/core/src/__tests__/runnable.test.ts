import { describe, expect, it } from 'vitest';
import type { NodeDefinition } from '../types/node.js';
import type { WorkflowGraph } from '../graph/graph.js';
import { analyzeRunnableWorkflow, workflowSubgraph } from '../graph/runnable.js';

const sourceNode: NodeDefinition<Record<string, never>, { value: 'number' }> = {
  id: 'source',
  category: 'source',
  displayName: 'Source',
  inputs: {},
  outputs: { value: { type: 'number', label: 'Value' } },
  async execute() {
    return { value: 1 };
  },
};

const sinkNode: NodeDefinition<{ value: 'number' }, { label: 'string' }> = {
  id: 'sink',
  category: 'display',
  displayName: 'Sink',
  inputs: { value: { type: 'number', label: 'Value' } },
  outputs: { label: { type: 'string', label: 'Label' } },
  async execute(_ctx, { inputs }) {
    return { label: `value=${inputs.value}` };
  },
};

function makeGraph(
  nodeIds: string[],
  edges: Array<{ source: string; target: string }>,
): WorkflowGraph {
  const nodes = new Map<string, NodeDefinition>();
  for (const nodeId of nodeIds) {
    if (nodeId === 'source') {
      nodes.set(nodeId, sourceNode as NodeDefinition);
    } else {
      nodes.set(nodeId, { ...sinkNode, id: nodeId, displayName: nodeId } as NodeDefinition);
    }
  }

  return {
    version: 1,
    nodes,
    edges: edges.map((edge, index) => ({
      id: `edge-${index}`,
      sourceNodeId: edge.source,
      sourceOutput: 'value',
      targetNodeId: edge.target,
      targetInput: 'value',
    })),
  };
}

describe('analyzeRunnableWorkflow', () => {
  it('marks a fully connected chain as runnable', () => {
    const graph = makeGraph(['source', 'sink'], [{ source: 'source', target: 'sink' }]);
    const { runnableNodeIds, skippedNodeIds } = analyzeRunnableWorkflow(graph);

    expect([...runnableNodeIds].sort()).toEqual(['sink', 'source']);
    expect(skippedNodeIds.size).toBe(0);
  });

  it('skips nodes with disconnected required inputs', () => {
    const graph = makeGraph(['source', 'sink', 'orphan'], [
      { source: 'source', target: 'sink' },
    ]);
    const { runnableNodeIds, skippedNodeIds } = analyzeRunnableWorkflow(graph);

    expect([...runnableNodeIds].sort()).toEqual(['sink', 'source']);
    expect([...skippedNodeIds]).toEqual(['orphan']);
  });

  it('skips downstream nodes when upstream is not runnable', () => {
    const graph = makeGraph(['source', 'middle', 'tail'], [
      { source: 'source', target: 'tail' },
      { source: 'middle', target: 'tail' },
    ]);
    const { runnableNodeIds, skippedNodeIds } = analyzeRunnableWorkflow(graph);

    expect([...runnableNodeIds].sort()).toEqual(['source']);
    expect([...skippedNodeIds].sort()).toEqual(['middle', 'tail']);
  });

  it('returns empty runnable set when every node is incomplete', () => {
    const graph = makeGraph(['orphan-a', 'orphan-b'], []);
    const { runnableNodeIds, skippedNodeIds } = analyzeRunnableWorkflow(graph);

    expect(runnableNodeIds.size).toBe(0);
    expect(skippedNodeIds.size).toBe(2);
  });

  it('skips ignored nodes and their downstream dependencies', () => {
    const graph = makeGraph(['source', 'middle', 'tail'], [
      { source: 'source', target: 'middle' },
      { source: 'middle', target: 'tail' },
    ]);
    const { runnableNodeIds, skippedNodeIds } = analyzeRunnableWorkflow(graph, {
      ignoredNodeIds: new Set(['middle']),
    });

    expect([...runnableNodeIds]).toEqual(['source']);
    expect([...skippedNodeIds].sort()).toEqual(['middle', 'tail']);
  });
});

describe('workflowSubgraph', () => {
  it('keeps only nodes and edges inside the runnable set', () => {
    const graph = makeGraph(['source', 'sink', 'orphan'], [
      { source: 'source', target: 'sink' },
    ]);
    const subgraph = workflowSubgraph(graph, new Set(['source', 'sink']));

    expect([...subgraph.nodes.keys()].sort()).toEqual(['sink', 'source']);
    expect(subgraph.edges).toHaveLength(1);
    expect(subgraph.edges[0]?.targetNodeId).toBe('sink');
  });
});

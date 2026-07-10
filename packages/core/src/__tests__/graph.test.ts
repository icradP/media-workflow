import { describe, it, expect } from 'vitest';
import { topologicalSort, topologicalLevels, hasCycle, affectedSubgraph } from '../graph/topo';
import type { WorkflowGraph } from '../graph/graph';
import type { NodeDefinition } from '../types/node';

function makeMockNode(id: string): NodeDefinition {
  return {
    id,
    category: 'utility',
    displayName: id,
    inputs: {},
    outputs: {},
    async execute() {
      return {};
    },
  };
}

function makeGraph(edges: [string, string][]): WorkflowGraph {
  const nodeIds = new Set<string>();
  for (const [src, tgt] of edges) {
    nodeIds.add(src);
    nodeIds.add(tgt);
  }
  const nodes = new Map<string, NodeDefinition>();
  for (const id of nodeIds) {
    nodes.set(id, makeMockNode(id));
  }
  return {
    version: 1,
    nodes,
    edges: edges.map(([sourceNodeId, targetNodeId], i) => ({
      id: `e${i}`,
      sourceNodeId,
      sourceOutput: 'out',
      targetNodeId,
      targetInput: 'in',
    })),
  };
}

describe('topologicalSort', () => {
  it('should sort a linear chain', () => {
    const graph = makeGraph([['A', 'B'], ['B', 'C']]);
    const sorted = topologicalSort(graph);
    expect(sorted).toEqual(['A', 'B', 'C']);
  });

  it('should sort a diamond', () => {
    const graph = makeGraph([['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D']]);
    const sorted = topologicalSort(graph);
    expect(sorted.indexOf('A')).toBe(0);
    expect(sorted.indexOf('D')).toBe(3);
    // B 和 C 都在 D 之前
    expect(sorted.indexOf('B')).toBeLessThan(sorted.indexOf('D'));
    expect(sorted.indexOf('C')).toBeLessThan(sorted.indexOf('D'));
  });

  it('should detect simple cycle', () => {
    const graph = makeGraph([['A', 'B'], ['B', 'A']]);
    expect(() => topologicalSort(graph)).toThrow('Cycle detected');
  });

  it('should detect self-loop', () => {
    const graph = makeGraph([['A', 'A']]);
    expect(() => topologicalSort(graph)).toThrow('Cycle detected');
  });
});

describe('topologicalLevels', () => {
  it('should group independent nodes in same level', () => {
    // A → B, A → C: B 和 C 应在同一层
    const graph = makeGraph([['A', 'B'], ['A', 'C']]);
    const levels = topologicalLevels(graph);
    expect(levels[0]).toEqual(['A']);
    // B 和 C 都在 level 1 (同一层)
    expect(levels[1]).toEqual(expect.arrayContaining(['B', 'C']));
  });
});

describe('hasCycle', () => {
  it('should return false for DAG', () => {
    const graph = makeGraph([['A', 'B'], ['B', 'C']]);
    expect(hasCycle(graph)).toBe(false);
  });

  it('should return true for cycle', () => {
    const graph = makeGraph([['A', 'B'], ['B', 'C'], ['C', 'A']]);
    expect(hasCycle(graph)).toBe(true);
  });
});

describe('affectedSubgraph', () => {
  it('should include dirty node and all downstream', () => {
    // A → B → C → D
    const graph = makeGraph([['A', 'B'], ['B', 'C'], ['C', 'D']]);
    const affected = affectedSubgraph(graph, new Set(['B']));
    expect(new Set(affected)).toEqual(new Set(['B', 'C', 'D']));
  });

  it('should only include dirty node if no downstream', () => {
    const graph = makeGraph([['A', 'B']]);
    const affected = affectedSubgraph(graph, new Set(['B']));
    expect(new Set(affected)).toEqual(new Set(['B']));
  });
});

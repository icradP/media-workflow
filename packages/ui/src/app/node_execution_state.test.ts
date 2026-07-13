import { describe, expect, it } from 'vitest';
import {
  clearNodeExecutionIgnored,
  clearNodeExecutionStates,
  collectIgnoredNodeIds,
  markNodeExecutionFailed,
  setNodesExecutionIgnored,
  type ExecutionHighlightNode,
} from './node_execution_state.js';

describe('node execution highlight', () => {
  it('marks and clears failed node state', () => {
    const graph = {
      _nodes: [
        { id: 1, size: [240, 120] as [number, number] },
        { id: 2, size: [240, 120] as [number, number] },
      ] as ExecutionHighlightNode[],
    };

    const failed = markNodeExecutionFailed(graph, '2', 'boom');
    expect(failed?.executionState).toBe('failed');
    expect(failed?.executionError).toBe('boom');
    expect(failed?.boxcolor).toBe('#ff647c');

    clearNodeExecutionStates(graph);
    const node = graph._nodes[1];
    expect(node?.executionState).toBe('idle');
    expect(node?.executionError).toBeUndefined();
    expect(node?.boxcolor).toBeUndefined();
  });

  it('marks ignored nodes without clearing them on run reset', () => {
    const graph = {
      _nodes: [
        { id: 1, size: [240, 120] as [number, number] },
        { id: 2, size: [240, 120] as [number, number] },
      ] as ExecutionHighlightNode[],
    };

    setNodesExecutionIgnored(graph, ['1', '2'], true);
    expect(collectIgnoredNodeIds(graph)).toEqual(new Set(['1', '2']));

    clearNodeExecutionStates(graph);
    expect(collectIgnoredNodeIds(graph)).toEqual(new Set(['1', '2']));

    setNodesExecutionIgnored(graph, ['1'], false);
    expect(collectIgnoredNodeIds(graph)).toEqual(new Set(['2']));

    clearNodeExecutionIgnored(graph);
    expect(collectIgnoredNodeIds(graph)).toEqual(new Set());
  });
});

import { describe, expect, it } from 'vitest';
import type { NodeDefinition } from '../types/node.js';
import type { WorkflowGraph } from '../graph/graph.js';
import { createMemoryCache, stableFingerprint } from '../runtime/cache.js';
import { executeGraph } from '../runtime/scheduler.js';
import { validateWorkflowGraph } from '../graph/validate.js';
import { analyzeRunnableWorkflow } from '../graph/runnable.js';

const sourceNode: NodeDefinition<Record<string, never>, { value: 'number' }> = {
  id: 'source',
  category: 'source',
  displayName: 'Source',
  inputs: {},
  outputs: { value: { type: 'number', label: 'Value' } },
  async execute() {
    return { value: 42 };
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

describe('workflow runtime protocol', () => {
  it('reports disconnected required inputs before execution', () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: new Map([['sink', sinkNode as NodeDefinition]]),
      edges: [],
    };

    expect(validateWorkflowGraph(graph)).toMatchObject([
      { code: 'required_input', nodeId: 'sink' },
    ]);
  });

  it('emits typed execution events with resolved inputs and outputs', async () => {
    const graph: WorkflowGraph = {
      version: 1,
      nodes: new Map<string, NodeDefinition>([
        ['source', sourceNode as NodeDefinition],
        ['sink', sinkNode as NodeDefinition],
      ]),
      edges: [{
        id: 'edge',
        sourceNodeId: 'source',
        sourceOutput: 'value',
        targetNodeId: 'sink',
        targetInput: 'value',
      }],
    };
    const events: Array<{ id: string; input?: unknown; output?: unknown }> = [];

    await executeGraph(
      graph,
      createMemoryCache(),
      new AbortController().signal,
      event => {
        events.push({
          id: event.nodeId,
          input: event.inputs.value,
          output: event.outputs.label,
        });
      },
    );

    expect(events).toEqual([
      { id: 'source', input: undefined, output: undefined },
      { id: 'sink', input: 42, output: 'value=42' },
    ]);
  });

  it('fingerprints media sources by source identity and version', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const first = stableFingerprint({ sourceId: 'file:a', version: '1', data: bytes });
    const same = stableFingerprint({ sourceId: 'file:a', version: '1', data: new Uint8Array([9]) });
    const changed = stableFingerprint({ sourceId: 'file:a', version: '2', data: bytes });

    expect(first).toBe(same);
    expect(changed).not.toBe(first);
  });

  it('executes only runnable nodes when runnableNodeIds is provided', async () => {
    const orphanSink: NodeDefinition<{ value: 'number' }, { label: 'string' }> = {
      id: 'orphan',
      category: 'display',
      displayName: 'Orphan',
      inputs: { value: { type: 'number', label: 'Value' } },
      outputs: { label: { type: 'string', label: 'Label' } },
      async execute() {
        return { label: 'should-not-run' };
      },
    };

    const graph: WorkflowGraph = {
      version: 1,
      nodes: new Map<string, NodeDefinition>([
        ['source', sourceNode as NodeDefinition],
        ['sink', sinkNode as NodeDefinition],
        ['orphan', orphanSink as NodeDefinition],
      ]),
      edges: [{
        id: 'edge',
        sourceNodeId: 'source',
        sourceOutput: 'value',
        targetNodeId: 'sink',
        targetInput: 'value',
      }],
    };

    const { runnableNodeIds } = analyzeRunnableWorkflow(graph);
    const events: string[] = [];

    const results = await executeGraph(
      graph,
      createMemoryCache(),
      new AbortController().signal,
      event => {
        events.push(event.nodeId);
      },
      { runnableNodeIds },
    );

    expect(events).toEqual(['source', 'sink']);
    expect(results.has('orphan')).toBe(false);
    expect(results.get('sink')?.get('label')).toBe('value=42');
  });
});

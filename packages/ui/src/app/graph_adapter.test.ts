import { describe, expect, it } from 'vitest';
import { LGraph, LiteGraph } from 'litegraph.js';
import { registerNodeTypes } from './app.js';
import { extractWorkflowFromLGraph } from './graph_adapter.js';

describe('LiteGraph workflow adapter', () => {
  it('creates compatible typed ports and maps their links to workflow edges', () => {
    let requestedFileNodeId: number | null = null;
    registerNodeTypes({
      onRequestFile: node => {
        requestedFileNodeId = node.id;
      },
    });
    const graph = new LGraph();
    const fileNode = LiteGraph.createNode('media/file_loader');
    const detectNode = LiteGraph.createNode('media/auto_analyze');
    const streamNode = LiteGraph.createNode('media/stream_overview');

    graph.add(fileNode);
    graph.add(detectNode);
    graph.add(streamNode);

    const fileWidget = (fileNode as unknown as {
      widgets: Array<{ name: string; callback: () => void }>;
    }).widgets[0];
    expect(fileWidget?.name).toBe('选择文件…');
    fileWidget?.callback();
    expect(requestedFileNodeId).toBe(fileNode.id);

    expect(fileNode.outputs[0]?.type).toBe('media_source');
    expect(detectNode.inputs[0]?.type).toBe('media_source');
    expect(detectNode.outputs[0]?.type).toBe('media_asset');
    expect(streamNode.inputs[0]?.type).toBe('media_asset');
    expect(fileNode.connect(0, detectNode, 0)).not.toBeNull();
    expect(detectNode.connect(0, streamNode, 0)).not.toBeNull();

    const extracted = extractWorkflowFromLGraph(graph);

    expect([...extracted.nodeTypes.values()]).toEqual([
      'file_loader',
      'auto_analyze',
      'stream_overview',
    ]);
    expect(extracted.graph.edges).toMatchObject([
      {
        sourceNodeId: String(fileNode.id),
        sourceOutput: 'source',
        targetNodeId: String(detectNode.id),
        targetInput: 'source',
      },
      {
        sourceNodeId: String(detectNode.id),
        sourceOutput: 'asset',
        targetNodeId: String(streamNode.id),
        targetInput: 'asset',
      },
    ]);
  });
});

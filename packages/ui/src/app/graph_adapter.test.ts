import { describe, expect, it } from 'vitest';
import { LGraph, LiteGraph } from 'litegraph.js';
import { WORKFLOW_PRESET_CATALOG } from '@media-workflow/nodes';
import { registerNodeTypes } from './app.js';
import { extractWorkflowFromLGraph, loadWorkflowPresetIntoLGraph } from './graph_adapter.js';

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
    const hexNode = LiteGraph.createNode('media/hex_view');
    const frameSelectorNode = LiteGraph.createNode('media/frame_selector');
    const frameHexNode = LiteGraph.createNode('media/hex_view');

    graph.add(fileNode);
    graph.add(detectNode);
    graph.add(streamNode);
    graph.add(hexNode);
    graph.add(frameSelectorNode);
    graph.add(frameHexNode);

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
    expect(String(hexNode.inputs[0]?.type)).toContain('media_source');
    expect(fileNode.connect(0, detectNode, 0)).not.toBeNull();
    expect(detectNode.connect(0, streamNode, 0)).not.toBeNull();
    expect(fileNode.connect(0, hexNode, 0)).not.toBeNull();
    expect(frameSelectorNode.connect(0, frameHexNode, 0)).not.toBeNull();

    const extracted = extractWorkflowFromLGraph(graph);

    expect([...extracted.nodeTypes.values()]).toEqual([
      'file_loader',
      'auto_analyze',
      'stream_overview',
      'hex_view',
      'frame_selector',
      'hex_view',
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
      {
        sourceNodeId: String(fileNode.id),
        sourceOutput: 'source',
        targetNodeId: String(hexNode.id),
        targetInput: 'bytes',
      },
      {
        sourceNodeId: String(frameSelectorNode.id),
        sourceOutput: 'samples',
        targetNodeId: String(frameHexNode.id),
        targetInput: 'bytes',
      },
    ]);
  });

  it('loads a workflow preset into LiteGraph with matching edges', () => {
    registerNodeTypes();
    const graph = new LGraph();
    const preset = WORKFLOW_PRESET_CATALOG.find(entry => entry.id === 'quick-overview')?.preset;
    expect(preset).toBeDefined();

    loadWorkflowPresetIntoLGraph(graph, preset!);

    const extracted = extractWorkflowFromLGraph(graph);
    expect([...extracted.nodeTypes.values()]).toEqual([
      'file_loader',
      'auto_analyze',
      'stream_overview',
    ]);
    expect(extracted.graph.edges).toMatchObject([
      {
        sourceOutput: 'source',
        targetInput: 'source',
      },
      {
        sourceOutput: 'asset',
        targetInput: 'asset',
      },
    ]);
  });

  it('maps inline node widget values to workflow params', () => {
    registerNodeTypes();
    const graph = new LGraph();
    const node = LiteGraph.createNode('media/audio_range_request');
    graph.add(node);

    const typedNode = node as unknown as {
      properties: Record<string, unknown>;
      widgets: Array<{ name: string; value: unknown }>;
    };

    expect(typedNode.widgets.map(widget => widget.name)).toEqual([
      'startTimeSeconds',
      'endTimeSeconds',
    ]);
    expect(typedNode.properties).toMatchObject({
      startTimeSeconds: 0,
      endTimeSeconds: 5,
    });

    typedNode.properties.startTimeSeconds = 12.5;
    typedNode.properties.endTimeSeconds = 18;
    const widget = typedNode.widgets.find(item => item.name === 'startTimeSeconds');
    if (widget) widget.value = 12.5;

    const extracted = extractWorkflowFromLGraph(graph);
    const instance = [...extracted.graph.nodes.values()][0];
    expect(instance?.params).toMatchObject({
      startTimeSeconds: { default: 12.5 },
      endTimeSeconds: { default: 18 },
    });
  });
});

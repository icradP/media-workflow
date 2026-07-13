import { describe, expect, it } from 'vitest';
import { LGraph, LiteGraph } from 'litegraph.js';
import { WORKFLOW_PRESET_CATALOG } from '@media-workflow/nodes';
import { registerNodeTypes } from './app.js';
import {
  exportWorkflowPresetFromLGraph,
  extractWorkflowFromLGraph,
  loadWorkflowPresetIntoLGraph,
} from './graph_adapter.js';

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
    const mediaSelectNode = LiteGraph.createNode('media/media_select');
    const frameHexNode = LiteGraph.createNode('media/hex_view');

    graph.add(fileNode);
    graph.add(detectNode);
    graph.add(streamNode);
    graph.add(hexNode);
    graph.add(mediaSelectNode);
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
    expect(detectNode.connect(0, mediaSelectNode, 0)).not.toBeNull();
    expect(mediaSelectNode.connect(0, frameHexNode, 0)).not.toBeNull();

    const extracted = extractWorkflowFromLGraph(graph);

    expect([...extracted.nodeTypes.values()]).toEqual([
      'file_loader',
      'auto_analyze',
      'stream_overview',
      'hex_view',
      'media_select',
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
        sourceNodeId: String(detectNode.id),
        sourceOutput: 'asset',
        targetNodeId: String(mediaSelectNode.id),
        targetInput: 'source',
      },
      {
        sourceNodeId: String(mediaSelectNode.id),
        sourceOutput: 'selection',
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
    const node = LiteGraph.createNode('media/frame_extract');
    graph.add(node);

    const typedNode = node as unknown as {
      properties: Record<string, unknown>;
      widgets: Array<{ name: string; value: unknown }>;
    };

    expect(typedNode.widgets.map(widget => widget.name)).toEqual([
      'mode',
      'index',
      'sampleId',
      'ptsSeconds',
    ]);
    expect(typedNode.properties).toMatchObject({
      mode: 'first',
      index: 0,
      ptsSeconds: 0,
    });

    typedNode.properties.mode = 'pts';
    typedNode.properties.ptsSeconds = 12.5;
    const widget = typedNode.widgets.find(item => item.name === 'ptsSeconds');
    if (widget) widget.value = 12.5;

    const extracted = extractWorkflowFromLGraph(graph);
    const instance = [...extracted.graph.nodes.values()][0];
    expect(instance?.params).toMatchObject({
      mode: { default: 'pts' },
      ptsSeconds: { default: 12.5 },
    });
  });

  it('exports a local preset with positions, parameters, and links', () => {
    registerNodeTypes();
    const graph = new LGraph();
    const source = LiteGraph.createNode('media/file_loader');
    const analyze = LiteGraph.createNode('media/auto_analyze');
    source.pos = [40, 80];
    analyze.pos = [320, 80];
    graph.add(source);
    graph.add(analyze);
    source.connect(0, analyze, 0);

    const preset = exportWorkflowPresetFromLGraph(graph, 'Local test');

    expect(preset.name).toBe('Local test');
    expect(preset.nodes).toMatchObject([
      { type: 'file_loader', position: [40, 80] },
      { type: 'auto_analyze', position: [320, 80] },
    ]);
    expect(preset.edges).toMatchObject([
      { sourceOutput: 'source', targetInput: 'source' },
    ]);
  });
});

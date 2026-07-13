/**
 * LiteGraph ↔ WorkflowGraph 适配层
 */

import type {
  Edge,
  NodeDefinition,
  NodeParamDef,
  WorkflowGraph,
} from '@media-workflow/core';
import { LiteGraph, type LGraph } from 'litegraph.js';
import {
  mediaSourceFromFile,
  nodeRegistry,
  type WorkflowPreset,
} from '@media-workflow/nodes';

interface LGraphNodeLike {
  id: number;
  type: string;
  pos?: [number, number];
  inputs?: Array<{ name: string; link?: number | null }>;
  outputs?: Array<{ name: string; links?: number[] | null }>;
  properties?: Record<string, unknown>;
}

interface LLinkLike {
  id: number;
  origin_id: number;
  origin_slot: number;
  target_id: number;
  target_slot: number;
}

type LGraphInternal = {
  _nodes: LGraphNodeLike[];
  links: Record<string, LLinkLike>;
  getNodeById: (id: number) => LGraphNodeLike | null;
};

function asGraphInternal(graph: LGraph): LGraphInternal {
  return graph as unknown as LGraphInternal;
}

export interface ExtractWorkflowOptions {
  /** 按画布节点 ID 解析已选文件；未设置时回退到 defaultFile */
  getFileForNode?: (nodeId: string) => File | null | undefined;
  defaultFile?: File | null;
}

export interface ExtractedWorkflow {
  graph: WorkflowGraph;
  /** canvas node id → node definition id (e.g. "file_loader") */
  nodeTypes: Map<string, string>;
}

export function exportWorkflowPresetFromLGraph(
  graph: LGraph,
  name = 'Local workflow',
): WorkflowPreset {
  const internal = asGraphInternal(graph);
  return {
    version: 1,
    name,
    description: 'Saved from Media Flow',
    nodes: internal._nodes.map(node => ({
      id: String(node.id),
      type: node.type.replace(/^media\//, ''),
      position: node.pos ? [node.pos[0], node.pos[1]] : undefined,
      params: { ...node.properties },
    })),
    edges: extractEdges(internal),
  };
}

function wrapFileLoader(
  base: NodeDefinition,
  nodeId: string,
  file: File | null | undefined,
): NodeDefinition {
  return {
    ...base,
    async execute(ctx, options) {
      if (!file) {
        throw new Error(
          `File Loader (${nodeId}): no file loaded. Drop a file onto the canvas or use Open File.`,
        );
      }
      const source = await mediaSourceFromFile(file);
      ctx.log.info(`FileLoader: loaded ${file.name} (${source.size} bytes)`);
      return { source };
    },
  };
}

function extractEdges(g: LGraphInternal): Edge[] {
  const edges: Edge[] = [];

  for (const link of Object.values(g.links ?? {})) {
    if (!link) continue;

    const src = g.getNodeById(link.origin_id);
    const tgt = g.getNodeById(link.target_id);
    if (!src?.outputs || !tgt?.inputs) continue;

    const sourceOutput = src.outputs[link.origin_slot]?.name;
    const targetInput = tgt.inputs[link.target_slot]?.name;
    if (!sourceOutput || !targetInput) continue;

    edges.push({
      id: String(link.id),
      sourceNodeId: String(link.origin_id),
      sourceOutput,
      targetNodeId: String(link.target_id),
      targetInput,
    });
  }

  return edges;
}

function applyNodeParams(
  base: NodeDefinition,
  properties: Record<string, unknown> | undefined,
): NodeDefinition {
  if (!base.params) return base;
  const params = Object.fromEntries(
    Object.entries(base.params).map(([name, definition]) => [
      name,
      {
        ...definition,
        default: coerceParamValue(definition, properties?.[name]),
      },
    ]),
  ) as Record<string, NodeParamDef>;
  return { ...base, params };
}

function coerceParamValue(definition: NodeParamDef, value: unknown): string | number | boolean {
  if (value === undefined) return definition.default;
  switch (definition.type) {
    case 'number':
      return Number.isFinite(Number(value)) ? Number(value) : definition.default;
    case 'boolean':
      return Boolean(value);
    case 'enum':
      return definition.values.includes(String(value)) ? String(value) : definition.default;
    case 'string':
      return String(value);
  }
}

function findOutputSlot(node: LGraphNodeLike, outputName: string): number {
  const index = node.outputs?.findIndex(output => output.name === outputName) ?? -1;
  if (index < 0) {
    throw new Error(`Output ${outputName} not found on node ${node.id}`);
  }
  return index;
}

function findInputSlot(node: LGraphNodeLike, inputName: string): number {
  const index = node.inputs?.findIndex(input => input.name === inputName) ?? -1;
  if (index < 0) {
    throw new Error(`Input ${inputName} not found on node ${node.id}`);
  }
  return index;
}

export function loadWorkflowPresetIntoLGraph(
  graph: LGraph,
  preset: WorkflowPreset,
): void {
  graph.clear();

  const instanceMap = new Map<string, LGraphNodeLike & {
    pos: [number, number];
    properties: Record<string, unknown>;
    connect(
      outputSlot: number,
      targetNode: LGraphNodeLike,
      targetSlot: number,
    ): unknown;
  }>();

  for (const instance of preset.nodes) {
    const typeName = `media/${instance.type}`;
    if (!nodeRegistry.has(instance.type)) {
      throw new Error(`Unknown preset node type: ${instance.type}`);
    }

    const node = LiteGraph.createNode(typeName) as (LGraphNodeLike & {
      pos: [number, number];
      properties: Record<string, unknown>;
      connect(
        outputSlot: number,
        targetNode: LGraphNodeLike,
        targetSlot: number,
      ): unknown;
    }) | null;
    if (!node) {
      throw new Error(`Failed to create LiteGraph node: ${instance.type}`);
    }

    node.pos = instance.position
      ? [instance.position[0], instance.position[1]]
      : [200, 200];
    node.properties ??= {};

    for (const [paramName, value] of Object.entries(instance.params ?? {})) {
      node.properties[paramName] = value;
      const widget = (node as {
        widgets?: Array<{ name: string; value: unknown }>;
      }).widgets?.find(candidate => candidate.name === paramName);
      if (widget) widget.value = value;
    }

    graph.add(node as never);
    instanceMap.set(instance.id, node);
  }

  for (const edge of preset.edges) {
    const source = instanceMap.get(edge.sourceNodeId);
    const target = instanceMap.get(edge.targetNodeId);
    if (!source || !target) {
      throw new Error(`Preset edge ${edge.id} references missing node instance`);
    }

    const outputSlot = findOutputSlot(source, edge.sourceOutput);
    const inputSlot = findInputSlot(target, edge.targetInput);
    const link = source.connect(outputSlot, target, inputSlot);
    if (link == null) {
      throw new Error(
        `Failed to connect ${edge.sourceNodeId}.${edge.sourceOutput} → ${edge.targetNodeId}.${edge.targetInput}`,
      );
    }
  }
}

export function extractWorkflowFromLGraph(
  graph: LGraph,
  options: ExtractWorkflowOptions = {},
): ExtractedWorkflow {
  const g = asGraphInternal(graph);
  const nodes = new Map<string, NodeDefinition>();
  const nodeTypes = new Map<string, string>();

  for (const n of g._nodes ?? []) {
    const defId = n.type.replace('media/', '');
    const baseDef = nodeRegistry.get(defId);
    if (!baseDef) continue;

    const nodeId = String(n.id);
    nodeTypes.set(nodeId, defId);

    let def: NodeDefinition = applyNodeParams(baseDef, n.properties);
    if (defId === 'file_loader') {
      const file = options.getFileForNode?.(nodeId) ?? options.defaultFile ?? null;
      def = wrapFileLoader(baseDef, nodeId, file);
    }

    nodes.set(nodeId, def);
  }

  return {
    graph: {
      version: 1,
      nodes,
      edges: extractEdges(g),
    },
    nodeTypes,
  };
}

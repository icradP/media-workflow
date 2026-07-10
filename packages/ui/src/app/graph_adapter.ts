/**
 * LiteGraph ↔ WorkflowGraph 适配层
 */

import type {
  Edge,
  NodeDefinition,
  NodeParamDef,
  WorkflowGraph,
} from '@media-workflow/core';
import type { LGraph } from 'litegraph.js';
import { mediaSourceFromFile, nodeRegistry } from '@media-workflow/nodes';

interface LGraphNodeLike {
  id: number;
  type: string;
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

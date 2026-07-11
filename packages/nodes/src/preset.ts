import {
  assertValidWorkflowGraph,
  type Edge,
  type NodeDefinition,
  type NodeParamDef,
  type WorkflowGraph,
} from '@media-workflow/core';
import { nodeRegistry } from './registry.js';

export interface WorkflowPresetNode {
  id: string;
  type: string;
  position?: [number, number];
  params?: Record<string, unknown>;
}

export interface WorkflowPreset {
  version: 1;
  name: string;
  description?: string;
  nodes: WorkflowPresetNode[];
  edges: Edge[];
}

export interface InstantiatePresetOptions {
  nodeOverrides?: ReadonlyMap<string, NodeDefinition>;
}

export function instantiateWorkflowPreset(
  preset: WorkflowPreset,
  options: InstantiatePresetOptions = {},
): WorkflowGraph {
  if (preset.version !== 1) {
    throw new Error(`Unsupported workflow preset version: ${String(preset.version)}`);
  }

  const nodes = new Map<string, NodeDefinition>();
  for (const instance of preset.nodes) {
    if (nodes.has(instance.id)) {
      throw new Error(`Duplicate preset node ID: ${instance.id}`);
    }
    const override = options.nodeOverrides?.get(instance.id);
    const definition = override ?? nodeRegistry.get(instance.type);
    if (!definition) {
      throw new Error(`Unknown preset node type: ${instance.type}`);
    }
    nodes.set(instance.id, applyPresetParams(definition, instance.params));
  }

  const graph: WorkflowGraph = {
    version: 1,
    nodes,
    edges: preset.edges.map(edge => ({ ...edge })),
    metadata: {
      name: preset.name,
      description: preset.description,
    },
  };
  assertValidWorkflowGraph(graph);
  return graph;
}

function applyPresetParams(
  definition: NodeDefinition,
  values: Record<string, unknown> | undefined,
): NodeDefinition {
  if (!definition.params || !values) return definition;
  const params = Object.fromEntries(
    Object.entries(definition.params).map(([name, param]) => [
      name,
      {
        ...param,
        default: coerceValue(param, values[name]),
      },
    ]),
  ) as Record<string, NodeParamDef>;
  return { ...definition, params };
}

function coerceValue(
  param: NodeParamDef,
  value: unknown,
): string | number | boolean {
  if (value === undefined) return param.default;
  switch (param.type) {
    case 'number': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return param.default;
      const minimum = param.min ?? Number.NEGATIVE_INFINITY;
      const maximum = param.max ?? Number.POSITIVE_INFINITY;
      return Math.min(maximum, Math.max(minimum, parsed));
    }
    case 'boolean':
      return Boolean(value);
    case 'string':
      return String(value);
    case 'enum': {
      const parsed = String(value);
      return param.values.includes(parsed) ? parsed : param.default;
    }
  }
}

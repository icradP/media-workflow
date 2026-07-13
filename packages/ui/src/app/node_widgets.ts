import type { NodeDefinition, NodeParamDef } from '@media-workflow/core';
import { LiteGraph } from 'litegraph.js';

interface WidgetHostNode {
  properties: Record<string, unknown>;
  addWidget: (
    type: string,
    name: string,
    value: unknown,
    callback: string | ((value?: unknown) => void),
    options?: Record<string, unknown>,
  ) => unknown;
  widgets?: Array<{ name: string; value: unknown }>;
  onWidgetChanged?: (
    name: string,
    value: unknown,
    oldValue: unknown,
  ) => void;
}

export function attachNodeParamWidgets(
  node: WidgetHostNode,
  nodeDef: NodeDefinition,
  onParamChange?: () => void,
): void {
  const params = Object.entries(nodeDef.params ?? {});
  if (params.length === 0) return;

  node.onWidgetChanged = (name, value) => {
    const key = resolvePropertyKey(nodeDef, name);
    if (key) node.properties[key] = value;
    onParamChange?.();
  };

  for (const [paramKey, param] of params) {
    node.properties[paramKey] = param.default;
    const widgetType = widgetTypeForParam(param);
    const widgetOptions = widgetOptionsForParam(param, paramKey);
    node.addWidget(
      widgetType,
      widgetLabel(param),
      param.default,
      paramKey,
      widgetOptions,
    );
  }
}

export function preferredNodeWidth(nodeDef: NodeDefinition): number {
  const labels = Object.values(nodeDef.params ?? {}).map(widgetLabel);
  const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
  const paramCount = Object.keys(nodeDef.params ?? {}).length;
  const base = nodeDef.id === 'file_loader' ? 220 : 240;
  return Math.max(base, longest * 7 + 120, 200 + paramCount * 4);
}

function widgetTypeForParam(param: NodeParamDef): string {
  if (param.type === 'boolean') return 'toggle';
  if (param.type === 'enum') return 'combo';
  if (param.type === 'string') return 'text';
  return 'number';
}

function widgetOptionsForParam(
  param: NodeParamDef,
  paramKey: string,
): Record<string, unknown> {
  const common = { property: paramKey };
  if (param.type === 'enum') {
    return { ...common, values: param.values };
  }
  if (param.type === 'number') {
    return {
      ...common,
      min: param.min,
      max: param.max,
      step: param.step ?? 1,
      precision: Number.isInteger(param.step ?? 1) ? 0 : 2,
    };
  }
  return common;
}

function widgetLabel(param: NodeParamDef): string {
  return param.name || 'value';
}

function resolvePropertyKey(
  nodeDef: NodeDefinition,
  widgetName: string,
): string | undefined {
  if (nodeDef.params?.[widgetName]) return widgetName;
  return Object.entries(nodeDef.params ?? {}).find(
    ([, param]) => param.name === widgetName,
  )?.[0];
}

export function minimumDisplayNodeHeight(nodeDef: NodeDefinition): number {
  const widgetCount = Object.keys(nodeDef.params ?? {}).length;
  const slotCount = Object.keys(nodeDef.inputs).length + Object.keys(nodeDef.outputs).length;
  const widgetHeight = widgetCount * (LiteGraph.NODE_WIDGET_HEIGHT + 4) + 8;
  const slotHeight = slotCount * LiteGraph.NODE_SLOT_HEIGHT;
  return LiteGraph.NODE_TITLE_HEIGHT + Math.max(slotHeight, widgetHeight) + 24;
}

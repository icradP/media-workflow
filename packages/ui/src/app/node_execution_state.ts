import { LiteGraph } from 'litegraph.js';

export type NodeExecutionState = 'idle' | 'running' | 'failed' | 'ignored';

export interface ExecutionHighlightNode {
  id: number;
  size: [number, number];
  executionState?: NodeExecutionState;
  executionError?: string;
  boxcolor?: string;
  onDrawForeground?: (ctx: CanvasRenderingContext2D) => void;
}

interface GraphWithNodes {
  _nodes?: ExecutionHighlightNode[];
}

interface DirtyCanvas {
  setDirty(foreground: boolean, background?: boolean): void;
}

const FAILURE_BORDER = '#ff647c';
const FAILURE_BADGE = '#ff647c';
const IGNORED_BORDER = '#8b93a7';
const IGNORED_BADGE = '#8b93a7';
const RUNNING_BORDER = '#7c5cff';
const RUNNING_BADGE = '#7c5cff';

let animationPhase = 0;
let animationFrameId: number | null = null;
let animationCanvas: DirtyCanvas | null = null;

export function attachExecutionHighlight(
  node: ExecutionHighlightNode,
  overlay?: (ctx: CanvasRenderingContext2D) => void,
): void {
  node.onDrawForeground = (ctx: CanvasRenderingContext2D) => {
    drawExecutionHighlight(node, ctx);
    overlay?.(ctx);
  };
}

export function startExecutionAnimation(canvas: DirtyCanvas): void {
  if (animationFrameId !== null) return;
  animationCanvas = canvas;
  const tick = (time: number) => {
    animationPhase = time;
    animationCanvas?.setDirty(true, false);
    animationFrameId = requestAnimationFrame(tick);
  };
  animationFrameId = requestAnimationFrame(tick);
}

export function stopExecutionAnimation(): void {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  animationCanvas = null;
}

export function clearNodeExecutionStates(graph: unknown): void {
  for (const node of graphNodes(graph)) {
    if (node.executionState === 'failed' || node.executionState === 'running') {
      node.executionState = 'idle';
      node.executionError = undefined;
      if (node.boxcolor === FAILURE_BORDER || node.boxcolor === RUNNING_BORDER) {
        node.boxcolor = undefined;
      }
    }
  }
}

export function clearNodeExecutionIgnored(graph: unknown): void {
  for (const node of graphNodes(graph)) {
    if (node.executionState === 'ignored') {
      node.executionState = 'idle';
    }
  }
}

export function collectIgnoredNodeIds(graph: unknown): Set<string> {
  const ignored = new Set<string>();
  for (const node of graphNodes(graph)) {
    if (node.executionState === 'ignored') {
      ignored.add(String(node.id));
    }
  }
  return ignored;
}

export function setNodesExecutionIgnored(
  graph: unknown,
  nodeIds: Iterable<string>,
  ignored: boolean,
): string[] {
  const updated: string[] = [];
  const targetIds = new Set(nodeIds);

  for (const node of graphNodes(graph)) {
    const nodeId = String(node.id);
    if (!targetIds.has(nodeId)) continue;

    if (ignored) {
      node.executionState = 'ignored';
      node.executionError = undefined;
      if (node.boxcolor === FAILURE_BORDER || node.boxcolor === RUNNING_BORDER) {
        node.boxcolor = undefined;
      }
    } else if (node.executionState === 'ignored') {
      node.executionState = 'idle';
    }
    updated.push(nodeId);
  }

  return updated;
}

export function markNodeExecutionRunning(
  graph: unknown,
  nodeId: string,
): ExecutionHighlightNode | undefined {
  const node = findGraphNode(graph, nodeId);
  if (!node || node.executionState === 'ignored') return undefined;

  node.executionState = 'running';
  node.executionError = undefined;
  node.boxcolor = RUNNING_BORDER;
  return node;
}

export function clearNodeExecutionRunning(
  graph: unknown,
  nodeId: string,
): ExecutionHighlightNode | undefined {
  const node = findGraphNode(graph, nodeId);
  if (!node || node.executionState !== 'running') return undefined;

  node.executionState = 'idle';
  if (node.boxcolor === RUNNING_BORDER) {
    node.boxcolor = undefined;
  }
  return node;
}

export function markNodeExecutionFailed(
  graph: unknown,
  nodeId: string,
  errorMessage?: string,
): ExecutionHighlightNode | undefined {
  const node = findGraphNode(graph, nodeId);
  if (!node) return undefined;

  node.executionState = 'failed';
  node.executionError = errorMessage;
  node.boxcolor = FAILURE_BORDER;
  return node;
}

export function drawExecutionHighlight(
  node: ExecutionHighlightNode,
  ctx: CanvasRenderingContext2D,
): void {
  if (node.executionState === 'running') {
    const pulse = 0.55 + 0.45 * Math.sin(animationPhase * 0.01);
    drawStateBadge(node, ctx, {
      border: RUNNING_BORDER,
      badge: RUNNING_BADGE,
      label: '执行中',
      dashed: true,
      alpha: pulse,
      dashOffset: -animationPhase * 0.06,
    });
    return;
  }

  if (node.executionState === 'failed') {
    drawStateBadge(node, ctx, {
      border: FAILURE_BORDER,
      badge: FAILURE_BADGE,
      label: '失败',
    });
    return;
  }

  if (node.executionState === 'ignored') {
    drawStateBadge(node, ctx, {
      border: IGNORED_BORDER,
      badge: IGNORED_BADGE,
      label: '忽略',
      dashed: true,
    });
  }
}

function drawStateBadge(
  node: ExecutionHighlightNode,
  ctx: CanvasRenderingContext2D,
  style: {
    border: string;
    badge: string;
    label: string;
    dashed?: boolean;
    alpha?: number;
    dashOffset?: number;
  },
): void {
  const titleHeight = LiteGraph.NODE_TITLE_HEIGHT;
  const width = node.size[0];
  const height = node.size[1];
  const padding = 4;

  ctx.save();
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 2;
  ctx.globalAlpha = style.alpha ?? (style.dashed ? 0.75 : 0.95);
  if (style.dashed) {
    ctx.setLineDash([6, 4]);
    if (style.dashOffset !== undefined) {
      ctx.lineDashOffset = style.dashOffset;
    }
  }
  ctx.beginPath();
  ctx.roundRect(
    -padding,
    -titleHeight - padding,
    width + padding * 2,
    height + titleHeight + padding * 2,
    8,
  );
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = style.badge;
  ctx.font = 'bold 10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(style.label, width - 8, -titleHeight + titleHeight / 2);
  ctx.restore();
}

function graphNodes(graph: unknown): ExecutionHighlightNode[] {
  return (graph as GraphWithNodes)._nodes ?? [];
}

function findGraphNode(
  graph: unknown,
  nodeId: string,
): ExecutionHighlightNode | undefined {
  return graphNodes(graph).find(node => String(node.id) === nodeId);
}

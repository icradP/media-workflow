import type { MediaSelection, NodeExecutionEvent } from '@media-workflow/core';
import { LiteGraph } from 'litegraph.js';
import type { ExecutionHighlightNode } from './node_execution_state.js';

export interface FrameSelectorPreview {
  sampleCount: number;
  durationSeconds: number;
  trackLabel: string;
}

export interface FrameSelectorNode extends ExecutionHighlightNode {
  properties: Record<string, unknown>;
  frameSelectorPreview?: FrameSelectorPreview | null;
  frameSelectorDrag?: 'start' | 'end' | null;
  size: [number, number];
  onMouseDown?: (
    event: MouseEvent,
    localPos: [number, number],
    canvas: unknown,
  ) => boolean;
  onMouseMove?: (
    event: MouseEvent,
    localPos: [number, number],
    canvas: unknown,
  ) => void;
  onMouseUp?: (
    event: MouseEvent,
    localPos: [number, number],
    canvas: unknown,
  ) => void;
}

const TIMELINE_HEIGHT = 48;
const TIMELINE_PAD_X = 12;
const HANDLE_WIDTH = 8;

export function attachFrameSelectorUi(
  node: FrameSelectorNode,
  onParamChange?: () => void,
): void {
  node.frameSelectorPreview = null;
  node.frameSelectorDrag = null;

  const previousForeground = node.onDrawForeground;
  node.onDrawForeground = (context: CanvasRenderingContext2D) => {
    previousForeground?.(context);
    drawFrameSelectorTimeline(node, context);
  };

  node.onMouseDown = (event, localPos, canvas) => {
    const drag = hitTestTimelineHandle(node, localPos[0], localPos[1]);
    if (!drag) return false;
    node.frameSelectorDrag = drag;
    updateTimelineFromPointer(node, localPos[0], onParamChange);
    (canvas as { setDirty(fg: boolean, bg?: boolean): void }).setDirty(true, true);
    return true;
  };

  node.onMouseMove = (event, localPos) => {
    if (!node.frameSelectorDrag) return;
    updateTimelineFromPointer(node, localPos[0], onParamChange);
  };

  node.onMouseUp = () => {
    if (!node.frameSelectorDrag) return;
    node.frameSelectorDrag = null;
    onParamChange?.();
    document.dispatchEvent(new CustomEvent('media-workflow:node-params-changed', {
      detail: { nodeId: String(node.id) },
    }));
  };
}

export function updateFrameSelectorPreviewFromEvent(
  node: FrameSelectorNode,
  event: NodeExecutionEvent,
): void {
  if (event.status === 'failed' || event.status === 'started') return;
  const selection = event.outputs.selection as MediaSelection | undefined;
  if (!selection) return;

  const track = selection.selectedTrack.track;
  const trackSamples = selection.selectedTrack.samples;
  if (trackSamples.length === 0) {
    node.frameSelectorPreview = {
      sampleCount: 0,
      durationSeconds: 0,
      trackLabel: track.trackId,
    };
    return;
  }

  const firstPtsUs = trackSamples[0]!.ptsUs;
  const last = trackSamples[trackSamples.length - 1]!;
  const durationSeconds = Math.max(
    0.001,
    (last.ptsUs - firstPtsUs + (last.durationUs ?? 0)) / 1_000_000,
  );

  node.frameSelectorPreview = {
    sampleCount: trackSamples.length,
    durationSeconds,
    trackLabel: track.trackId,
  };
}

export function formatFrameSelectorRange(
  properties: Record<string, unknown>,
  preview?: FrameSelectorPreview | null,
): string {
  const { start, end } = readTimeRange(properties);
  const endLabel = end === null ? '末尾' : `${end.toFixed(2)}s`;
  const countLabel = preview ? ` · ${preview.sampleCount} 帧` : '';
  return `${start.toFixed(2)}s – ${endLabel}${countLabel}`;
}

export function frameSelectorNodeHeight(): number {
  return LiteGraph.NODE_TITLE_HEIGHT + LiteGraph.NODE_SLOT_HEIGHT * 2 + TIMELINE_HEIGHT + 16;
}

export function frameSelectorNodeWidth(): number {
  return 300;
}

function drawFrameSelectorTimeline(
  node: FrameSelectorNode,
  context: CanvasRenderingContext2D,
): void {
  const isLight = document.documentElement.dataset.theme === 'light';
  const width = node.size[0];
  const timelineY = node.size[1] - TIMELINE_HEIGHT - 6;
  const barX = TIMELINE_PAD_X;
  const barWidth = width - TIMELINE_PAD_X * 2;
  const barY = timelineY + 14;
  const barHeight = 10;
  const { start, end } = readTimeRange(node.properties);
  const duration = resolveTimelineDuration(node.properties, node.frameSelectorPreview);
  const startRatio = clamp01(start / duration);
  const endRatio = end === null ? 1 : clamp01(end / duration);
  const selectionLeft = barX + barWidth * Math.min(startRatio, endRatio);
  const selectionRight = barX + barWidth * Math.max(startRatio, endRatio);

  context.save();
  context.beginPath();
  context.roundRect(8, timelineY, width - 16, TIMELINE_HEIGHT - 4, 6);
  context.fillStyle = isLight ? 'rgba(236, 238, 245, 0.96)' : 'rgba(9, 11, 16, 0.88)';
  context.fill();
  context.strokeStyle = isLight ? 'rgba(23, 28, 40, 0.12)' : 'rgba(255, 255, 255, 0.09)';
  context.stroke();

  context.fillStyle = isLight ? '#555e72' : '#aab2c5';
  context.font = '10px ui-sans-serif, system-ui, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText(
    node.frameSelectorPreview
      ? `${node.frameSelectorPreview.trackLabel} · ${node.frameSelectorPreview.durationSeconds.toFixed(2)}s`
      : '连接轨道后运行以加载时间轴',
    barX,
    timelineY + 4,
  );

  context.fillStyle = isLight ? 'rgba(23, 28, 40, 0.12)' : 'rgba(255, 255, 255, 0.12)';
  context.fillRect(barX, barY, barWidth, barHeight);

  context.fillStyle = isLight ? 'rgba(124, 92, 255, 0.35)' : 'rgba(124, 92, 255, 0.55)';
  context.fillRect(selectionLeft, barY, Math.max(2, selectionRight - selectionLeft), barHeight);

  drawHandle(context, selectionLeft, barY, barHeight, isLight);
  drawHandle(context, selectionRight, barY, barHeight, isLight);

  context.fillStyle = isLight ? '#3d4354' : '#d5d9e6';
  context.font = '10px ui-monospace, SFMono-Regular, monospace';
  context.textAlign = 'right';
  context.fillText(formatFrameSelectorRange(node.properties, node.frameSelectorPreview), width - barX, timelineY + 28);
  context.restore();
}

function drawHandle(
  context: CanvasRenderingContext2D,
  centerX: number,
  barY: number,
  barHeight: number,
  isLight: boolean,
): void {
  context.fillStyle = isLight ? '#7c5cff' : '#a78bfa';
  context.fillRect(centerX - HANDLE_WIDTH / 2, barY - 3, HANDLE_WIDTH, barHeight + 6);
}

function hitTestTimelineHandle(
  node: FrameSelectorNode,
  x: number,
  y: number,
): 'start' | 'end' | null {
  const timelineY = node.size[1] - TIMELINE_HEIGHT - 6;
  if (y < timelineY || y > timelineY + TIMELINE_HEIGHT) return null;

  const barX = TIMELINE_PAD_X;
  const barWidth = node.size[0] - TIMELINE_PAD_X * 2;
  const { start, end } = readTimeRange(node.properties);
  const duration = resolveTimelineDuration(node.properties, node.frameSelectorPreview);
  const startX = barX + barWidth * clamp01(start / duration);
  const endX = barX + barWidth * (end === null ? 1 : clamp01(end / duration));

  if (Math.abs(x - startX) <= HANDLE_WIDTH) return 'start';
  if (Math.abs(x - endX) <= HANDLE_WIDTH) return 'end';
  return null;
}

function updateTimelineFromPointer(
  node: FrameSelectorNode,
  x: number,
  onParamChange?: () => void,
): void {
  const barX = TIMELINE_PAD_X;
  const barWidth = node.size[0] - TIMELINE_PAD_X * 2;
  const duration = resolveTimelineDuration(node.properties, node.frameSelectorPreview);
  const ratio = clamp01((x - barX) / barWidth);
  const time = round3(ratio * duration);
  const { start, end } = readTimeRange(node.properties);

  if (node.frameSelectorDrag === 'start') {
    const upper = end ?? duration;
    node.properties.startTimeSeconds = Math.min(time, upper);
  } else if (node.frameSelectorDrag === 'end') {
    const lower = start;
    if (ratio >= 0.985) {
      node.properties.endTimeSeconds = -1;
    } else {
      node.properties.endTimeSeconds = Math.max(time, lower);
    }
  }

  onParamChange?.();
}

function readTimeRange(properties: Record<string, unknown>): {
  start: number;
  end: number | null;
} {
  const start = Math.max(0, Number(properties.startTimeSeconds) || 0);
  const endRaw = Number(properties.endTimeSeconds);
  const end = Number.isFinite(endRaw) && endRaw >= 0 ? endRaw : null;
  return { start, end };
}

function resolveTimelineDuration(
  properties: Record<string, unknown>,
  preview?: FrameSelectorPreview | null,
): number {
  if (preview && preview.durationSeconds > 0) return preview.durationSeconds;
  const { start, end } = readTimeRange(properties);
  return Math.max(1, end ?? start + 1, start + 1);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

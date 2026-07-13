/**
 * ComfyUI-style 画布绑定 — 节点注册 + 拖拽 + 执行
 */

import { LGraph, LGraphCanvas, LiteGraph } from 'litegraph.js';
import { installInlineNodeWidgetEditor } from './node_widget_editor.js';
import { bindGraphCanvas } from './canvas_layout.js';
import { installCanvasNodeMenu } from './canvas_node_menu.js';
import {
  attachExecutionHighlight,
  clearNodeExecutionStates,
  clearNodeExecutionIgnored,
  clearNodeExecutionRunning,
  collectIgnoredNodeIds,
  markNodeExecutionFailed,
  markNodeExecutionRunning,
  setNodesExecutionIgnored,
  startExecutionAnimation,
  stopExecutionAnimation,
} from './node_execution_state.js';
import {
  attachNodeParamWidgets,
  initNodeParamDefaults,
  minimumDisplayNodeHeight,
  preferredNodeWidth,
} from './node_widgets.js';
import {
  nodesByCategory,
  allNodes,
  WORKFLOW_PRESET_CATALOG,
  DEFAULT_WORKFLOW_PRESET_ID,
  type WorkflowPreset,
} from '@media-workflow/nodes';
import {
  BYTE_PRODUCING_PIN_TYPES,
  createMemoryCache,
  executeGraph,
  analyzeRunnableWorkflow,
} from '@media-workflow/core';
import type { ExecutionCache, NodeExecutionEvent } from '@media-workflow/core';
import {
  exportWorkflowPresetFromLGraph,
  extractWorkflowFromLGraph,
  loadWorkflowPresetIntoLGraph,
} from './graph_adapter.js';
import {
  attachFrameSelectorUi,
  frameSelectorNodeHeight,
  frameSelectorNodeWidth,
  updateFrameSelectorPreviewFromEvent,
  type FrameSelectorNode,
} from './frame_selector_ui.js';
import { initNodeInspector } from './node_inspector.js';
import {
  attachDeviceCaptureUi,
  deviceCaptureNodeHeight,
  deviceCaptureNodeWidth,
} from './device_capture_ui.js';
import { clearViewport, renderExecutionEvent } from './viewport.js';

// ─── Pin type → LiteGraph color ───

const PIN_COLORS: Record<string, string> = {
  buffer: '#4ecdc4',
  byte_data: '#4ecdc4',
  media_source: '#4ecdc4',
  media_probe: '#8b93a7',
  media_asset: '#ff6b6b',
  selection_source: '#c084fc',
  decode_source: '#c084fc',
  playback_source: '#1dd1a1',
  selected_track: '#7c5cff',
  media_selection: '#feca57',
  track_list: '#a29bfe',
  media_track: '#7c5cff',
  media_samples: '#feca57',
  encoded_packets: '#ff9f43',
  video_decode_request: '#54a0ff',
  audio_decode_request: '#5f27cd',
  decoded_video_frames: '#48dbfb',
  decoded_video: '#48dbfb',
  pcm_audio: '#5f27cd',
  encoded_track: '#ff9f43',
  media_file: '#10ac84',
  media: '#ff6b6b',
  stream: '#a29bfe',
  frames: '#feca57',
  compressed: '#ff9f43',
  video_frame: '#54a0ff',
  audio_buffer: '#5f27cd',
  nal_units: '#01a3a4',
  detections: '#f368e0',
  sei_payload: '#ff6348',
  number: '#dfe6e9',
  string: '#dfe6e9',
  boolean: '#dfe6e9',
  enum: '#dfe6e9',
};

const BYTE_DATA_LITEGRAPH_TYPES = [
  'byte_data',
  ...BYTE_PRODUCING_PIN_TYPES,
].join(',');

const TIMELINE_NODE_IDS = new Set([
  'media_select',
  'video_decode',
  'audio_decode',
]);

function liteGraphInputType(pinType: string): string {
  if (pinType === 'byte_data') return BYTE_DATA_LITEGRAPH_TYPES;
  if (pinType === 'selection_source') return 'media_asset,selected_track';
  if (pinType === 'decode_source') return 'media_asset,media_selection';
  if (pinType === 'playback_source') return 'media_file,media_source';
  return pinType;
}

const CATEGORY_COLORS: Record<string, string> = {
  source: '#4ecdc4',
  analyze: '#7c5cff',
  select: '#ff9f43',
  decode: '#54a0ff',
  inspect: '#feca57',
  transform: '#10ac84',
  export: '#1dd1a1',
  utility: '#f368e0',
  parser: '#7c5cff',
  demux: '#ff9f43',
  decoder: '#54a0ff',
  analysis: '#f368e0',
  display: '#feca57',
  encoder: '#10ac84',
};

type StatusState = 'idle' | 'running' | 'success' | 'error';
type Theme = 'light' | 'dark';

interface LGraphNodeBase {
  id: number;
  title: string;
  inputs: LGraphSlot[];
  outputs: LGraphSlot[];
  fileWidget?: LGraphWidget;
  displayPreview?: string[];
  displayCanvas?: HTMLCanvasElement;
  properties: Record<string, unknown>;
  onExecute?: () => void;
  onDrawForeground?: (context: CanvasRenderingContext2D) => void;
  pos: [number, number];
  size: [number, number];
  computeSize(): Float32Array | [number, number];
  addInput(name: string, type: string, options?: Partial<LGraphSlot>): LGraphSlot;
  addOutput(name: string, type: string, options?: Partial<LGraphSlot>): LGraphSlot;
  addWidget(
    type: string,
    name: string,
    value: unknown,
    callback: (value?: unknown) => void,
    options?: Record<string, unknown>,
  ): LGraphWidget;
}

interface LGraphSlot {
  name: string;
  type: string;
  label?: string;
  link?: number | null;
  links?: number[] | null;
  color_on?: string;
  color_off?: string;
}

interface LGraphWidget {
  name: string;
  label?: string;
  value: unknown;
}

interface RegisterNodeTypeOptions {
  onRequestFile?: (node: LGraphNodeBase) => void;
}

function configureLiteGraphLayout(): void {
  LiteGraph.NODE_SLOT_HEIGHT = 22;
  LiteGraph.NODE_WIDGET_HEIGHT = 22;
  LiteGraph.NODE_TITLE_HEIGHT = 32;
  LiteGraph.NODE_TEXT_SIZE = 12;
}

function applyComputedNodeSize(
  node: LGraphNodeBase & { computeSize(): Float32Array | [number, number] },
  nodeDef: (typeof allNodes)[number],
): void {
  const computed = node.computeSize();
  const width = Math.max(computed[0], preferredNodeWidth(nodeDef));
  const minHeight = minimumDisplayNodeHeight(nodeDef);
  const height = Math.max(computed[1], minHeight);

  if (TIMELINE_NODE_IDS.has(nodeDef.id)) {
    node.size = [frameSelectorNodeWidth(), frameSelectorNodeHeight()];
    return;
  }

  if (
    nodeDef.category === 'display' ||
    nodeDef.category === 'inspect' ||
    nodeDef.id === 'file_export'
  ) {
    node.size = [Math.max(width, 280), height + 156];
    return;
  }

  node.size = [width, height];
}

export function registerNodeTypes(
  options: RegisterNodeTypeOptions = {},
  onParamChange?: (nodeId: string) => void,
) {
  configureLiteGraphLayout();
  const canvasClass = LGraphCanvas as unknown as {
    link_type_colors: Record<string, string>;
  };

  for (const [pinType, color] of Object.entries(PIN_COLORS)) {
    canvasClass.link_type_colors[pinType] = color;
  }

  for (const nodeDef of allNodes) {
    const typeName = `media/${nodeDef.id}`;

    const inputs = Object.entries(nodeDef.inputs).map(([name, def]) => ({
      name,
      type: liteGraphInputType(def.type),
      label: def.label,
      color: PIN_COLORS[def.type],
    }));

    const outputs = Object.entries(nodeDef.outputs).map(([name, def]) => ({
      name,
      type: def.type,
      label: def.label,
      color: PIN_COLORS[def.type],
    }));

    function NodeClass(this: LGraphNodeBase) {
      this.title = nodeDef.displayName;
      this.properties = {};
      for (const input of inputs) {
        this.addInput(input.name, input.type, {
          label: input.label,
          color_on: input.color,
          color_off: input.color,
        });
      }
      for (const output of outputs) {
        this.addOutput(output.name, output.type, {
          label: output.label,
          color_on: output.color,
          color_off: output.color,
        });
      }
      if (nodeDef.id === 'file_loader') {
        this.fileWidget = this.addWidget('button', '选择文件…', null, () => {
          options.onRequestFile?.(this);
        });
      }
      if (nodeDef.id === 'device_capture') {
        attachDeviceCaptureUi(this as never, onParamChange);
      }
      initNodeParamDefaults(this as never, nodeDef);
      attachNodeParamWidgets(this as never, nodeDef, onParamChange);
      if (
        nodeDef.category === 'display' ||
        nodeDef.category === 'inspect' ||
        nodeDef.id === 'file_export'
      ) {
        this.displayPreview = ['等待分析结果…'];
        attachExecutionHighlight(this, context => drawDisplayPreview(this, context));
      } else {
        attachExecutionHighlight(this);
      }
      if (TIMELINE_NODE_IDS.has(nodeDef.id)) {
        attachFrameSelectorUi(
          this as FrameSelectorNode,
          () => onParamChange?.(String(this.id)),
        );
      }
      applyComputedNodeSize(this, nodeDef);
      this.onExecute = () => {
        // Execution handled by @media-workflow/core scheduler
      };
      this.pos = [200, 200];
    }

    NodeClass.prototype.constructor = NodeClass;
    NodeClass.prototype.title = nodeDef.displayName;

    LiteGraph.registerNodeType(typeName, NodeClass as never);
  }
}

function drawDisplayPreview(node: LGraphNodeBase, context: CanvasRenderingContext2D): void {
  const isLight = document.documentElement.dataset.theme === 'light';
  const panelHeight = node.displayCanvas ? 140 : 76;
  const panelY = node.size[1] - panelHeight - 8;
  const lines = node.displayPreview ?? ['等待分析结果…'];

  context.save();
  context.beginPath();
  context.roundRect(8, panelY, node.size[0] - 16, panelHeight, 7);
  context.fillStyle = isLight ? 'rgba(236, 238, 245, 0.96)' : 'rgba(9, 11, 16, 0.88)';
  context.fill();
  context.strokeStyle = isLight ? 'rgba(23, 28, 40, 0.12)' : 'rgba(255, 255, 255, 0.09)';
  context.stroke();
  context.beginPath();
  context.rect(13, panelY + 5, node.size[0] - 26, panelHeight - 10);
  context.clip();

  if (node.displayCanvas) {
    const labelHeight = 18;
    context.font = '10px ui-monospace, SFMono-Regular, monospace';
    context.fillStyle = isLight ? '#555e72' : '#aab2c5';
    context.fillText(lines[0] ?? 'Preview', 16, panelY + 16);

    const imageX = 14;
    const imageY = panelY + labelHeight + 4;
    const imageWidth = node.size[0] - 28;
    const imageHeight = panelHeight - labelHeight - 12;
    const scale = Math.min(
      imageWidth / node.displayCanvas.width,
      imageHeight / node.displayCanvas.height,
    );
    const drawWidth = Math.max(1, node.displayCanvas.width * scale);
    const drawHeight = Math.max(1, node.displayCanvas.height * scale);
    const drawX = imageX + (imageWidth - drawWidth) / 2;
    const drawY = imageY + (imageHeight - drawHeight) / 2;

    context.fillStyle = isLight ? '#111827' : '#030712';
    context.fillRect(imageX, imageY, imageWidth, imageHeight);
    context.drawImage(node.displayCanvas, drawX, drawY, drawWidth, drawHeight);
  } else {
    context.font = '10px ui-monospace, SFMono-Regular, monospace';
    context.fillStyle = isLight ? '#555e72' : '#aab2c5';
    lines.slice(0, 4).forEach((line, index) => {
      context.fillText(line, 16, panelY + 18 + index * 15);
    });
  }
  context.restore();
}

function summarizeDisplayEvent(event: NodeExecutionEvent): string[] {
  if (event.status === 'started') {
    return ['执行中…'];
  }

  if (event.status === 'failed') {
    return ['执行失败', event.error?.message ?? 'Unknown error'];
  }

  if (event.node.id === 'stream_overview') {
    const asset = event.inputs.asset as {
      container?: { format?: unknown };
      tracks?: Array<{
        kind?: unknown;
        codec?: unknown;
        width?: unknown;
        height?: unknown;
        sampleRate?: unknown;
        channels?: unknown;
      }>;
    } | undefined;
    const tracks = asset?.tracks ?? [];
    return [
      `${String(asset?.container?.format ?? 'unknown')} · ${tracks.length} tracks`,
      ...tracks.slice(0, 3).map(track => {
        const detail = track.kind === 'video' && track.width && track.height
          ? `${track.width}×${track.height}`
          : track.kind === 'audio' && track.sampleRate
            ? `${track.sampleRate} Hz / ${String(track.channels ?? '?')} ch`
            : '';
        return `${String(track.kind ?? 'data')} · ${String(track.codec ?? 'Unknown')} ${detail}`;
      }),
    ];
  }

  if (event.node.id === 'track_detail') {
    const selectedTrack = event.inputs.selectedTrack as { track?: {
      trackId?: unknown;
      kind?: unknown;
      codec?: unknown;
      sampleCount?: unknown;
    } } | undefined;
    const track = selectedTrack?.track;
    return [
      String(track?.trackId ?? 'No track'),
      `${String(track?.kind ?? 'unknown')} · ${String(track?.codec ?? 'Unknown')}`,
      `${String(track?.sampleCount ?? 0)} samples`,
    ];
  }

  if (event.node.id === 'sample_table') {
    const selection = event.outputs.selection as { samples?: unknown[] } | undefined;
    return [
      `${selection?.samples?.length ?? 0} samples`,
      'PTS / DTS / size / offset',
    ];
  }

  if (event.node.id === 'hex_view') {
    const preview = String(event.outputs.preview ?? '');
    return ['Hex preview', preview.slice(0, 46), preview.slice(46, 92)];
  }

  if (event.node.id === 'video_preview') {
    const frame = selectedPreviewFrame(event) as {
      displayWidth?: number;
      displayHeight?: number;
      format?: string;
      sourceSampleId?: string;
    } | undefined;
    return [
      `${frame?.displayWidth ?? '?'}×${frame?.displayHeight ?? '?'} · ${String(frame?.format ?? 'frame')}`,
      String(frame?.sourceSampleId ?? 'decoded frame'),
    ];
  }

  if (event.node.id === 'wav_player') {
    try {
      const payload = JSON.parse(String(event.outputs.preview ?? '{}')) as {
        fileName?: string;
        sampleRate?: number;
        channels?: number;
        durationMs?: number;
      };
      return [
        String(payload.fileName ?? 'audio.wav'),
        `${payload.sampleRate ?? '?'} Hz · ${payload.channels ?? '?'} ch`,
        `${((payload.durationMs ?? 0) / 1000).toFixed(2)} s`,
      ];
    } catch {
      return ['WAV ready', 'Use viewport player'];
    }
  }

  if (event.node.id === 'mp4_player') {
    try {
      const payload = JSON.parse(String(event.outputs.preview ?? '{}')) as {
        fileName?: string;
        durationMs?: number;
        videoTrackCount?: number;
        audioTrackCount?: number;
      };
      return [
        String(payload.fileName ?? 'video.mp4'),
        `${payload.videoTrackCount ?? 0} video · ${payload.audioTrackCount ?? 0} audio`,
        `${((payload.durationMs ?? 0) / 1000).toFixed(2)} s`,
      ];
    } catch {
      return ['MP4 ready', 'Use viewport player'];
    }
  }

  return [
    event.status === 'cached' ? '缓存命中' : '执行完成',
    `${event.durationMs.toFixed(1)} ms`,
  ];
}

function createYuvDisplayCanvas(event: NodeExecutionEvent): HTMLCanvasElement | undefined {
  const frame = selectedPreviewFrame(event) as {
    displayWidth?: number;
    displayHeight?: number;
    planes?: Uint8Array[];
    strides?: number[];
  } | undefined;

  if (!frame?.planes || !frame.displayWidth || !frame.displayHeight) return undefined;

  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = frame.displayWidth;
  previewCanvas.height = frame.displayHeight;
  renderI420FrameToCanvas(
    previewCanvas,
    frame.planes,
    frame.displayWidth,
    frame.displayHeight,
    frame.strides ?? [
      frame.displayWidth,
      Math.ceil(frame.displayWidth / 2),
      Math.ceil(frame.displayWidth / 2),
    ],
  );
  return previewCanvas;
}

function selectedPreviewFrame(event: NodeExecutionEvent): unknown {
  const video = event.inputs.video as { frames?: unknown[] } | undefined;
  const frames = video?.frames ?? [];
  if (frames.length === 0) return undefined;
  const requested = Math.max(0, Math.floor(Number(event.params.frameIndex) || 0));
  return frames[Math.min(frames.length - 1, requested)];
}

function renderI420FrameToCanvas(
  target: HTMLCanvasElement,
  planes: Uint8Array[],
  width: number,
  height: number,
  strides: number[],
): void {
  const context = target.getContext('2d');
  if (!context) return;
  const [yPlane, uPlane, vPlane] = planes;
  if (!yPlane || !uPlane || !vPlane) return;

  const yStride = strides[0] ?? width;
  const uvWidth = Math.ceil(width / 2);
  const uStride = strides[1] ?? uvWidth;
  const vStride = strides[2] ?? uvWidth;
  const image = context.createImageData(width, height);
  const rgba = image.data;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const y = yPlane[row * yStride + col]!;
      const u = uPlane[Math.floor(row / 2) * uStride + Math.floor(col / 2)]!;
      const v = vPlane[Math.floor(row / 2) * vStride + Math.floor(col / 2)]!;
      const c = y - 16;
      const d = u - 128;
      const e = v - 128;
      const index = (row * width + col) * 4;
      rgba[index] = clampByte((298 * c + 409 * e + 128) >> 8);
      rgba[index + 1] = clampByte((298 * c - 100 * d - 208 * e + 128) >> 8);
      rgba[index + 2] = clampByte((298 * c + 516 * d + 128) >> 8);
      rgba[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}

export interface MediaWorkflowApp {
  mount(): Promise<void>;
}

export function createApp(): MediaWorkflowApp {
  let graph: LGraph;
  let canvas: LGraphCanvas;
  let execCache: ExecutionCache;
  const filesByNode = new Map<string, File>();
  let fileInput: HTMLInputElement;
  let pendingFileNode: LGraphNodeBase | null = null;
  let isRunning = false;

  async function mount() {
    graph = new LGraph();
    execCache = createMemoryCache();

    const canvasWrap = document.getElementById('canvas-wrap')!;
    const canvasElement = document.createElement('canvas');
    canvasElement.setAttribute('aria-label', '节点编辑画布');
    canvasWrap.prepend(canvasElement);
    canvas = new LGraphCanvas(canvasElement, graph);
    canvas.background_image = '';
    canvas.render_canvas_border = false;
    (canvas as LGraphCanvas & { allow_searchbox: boolean }).allow_searchbox = false;
    bindGraphCanvas(canvas);

    registerNodeTypes(
      { onRequestFile: openFilePickerForNode },
      nodeId => execCache.invalidate(nodeId),
    );
    installInlineNodeWidgetEditor(canvas, canvasWrap, {
      onValueChange: nodeId => execCache.invalidate(nodeId),
    });
    installCanvasNodeMenu(canvas, {
      categories: nodesByCategory(),
      onAddNode: addNodeAtGraphPosition,
      getSelectedNodeIds: () => getSelectedCanvasNodeIds(canvas),
      onSetNodesIgnored: (nodeIds, ignored) => {
        const updated = setNodesExecutionIgnored(graph, nodeIds, ignored);
        if (updated.length === 0) return;
        canvas.setDirty(true, true);
        setStatus(
          ignored
            ? `已忽略 ${updated.length} 个节点 · 运行时将跳过`
            : `已恢复 ${updated.length} 个节点 · 将参与执行`,
          'idle',
        );
      },
    });
    initNodeInspector({
      getGraph: () => graph,
      getCanvas: () => canvas,
      onParamChange: nodeId => {
        execCache.invalidate(nodeId);
        canvas.setDirty(true, true);
      },
    });

    setupFilePicker();
    buildPalette();
    setupToolbar();
    setupWorkflowPresets();
    setupThemeToggle();
    setupNodeSearch();
    setupKeyboard();
    setupCanvasDrop(canvasWrap);

    renderEmptyViewport();
    loadWorkflowPreset(DEFAULT_WORKFLOW_PRESET_ID);
  }

  function setupWorkflowPresets() {
    const select = document.getElementById('workflow-preset-select') as HTMLSelectElement | null;
    const description = document.getElementById('workflow-preset-description');
    const loadButton = document.getElementById('load-workflow-preset-button');
    if (!select) return;

    select.innerHTML = '';
    for (const entry of WORKFLOW_PRESET_CATALOG) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      select.appendChild(option);
    }
    select.value = DEFAULT_WORKFLOW_PRESET_ID;
    updateWorkflowPresetDescription(description, DEFAULT_WORKFLOW_PRESET_ID);

    select.addEventListener('change', () => {
      updateWorkflowPresetDescription(description, select.value);
    });

    loadButton?.addEventListener('click', () => {
      loadWorkflowPreset(select.value);
    });
  }

  function updateWorkflowPresetDescription(
    element: HTMLElement | null,
    presetId: string,
  ) {
    if (!element) return;
    const entry = WORKFLOW_PRESET_CATALOG.find(candidate => candidate.id === presetId);
    element.textContent = entry?.description ?? '';
  }

  function loadWorkflowPreset(presetId: string) {
    const entry = WORKFLOW_PRESET_CATALOG.find(candidate => candidate.id === presetId);
    if (!entry) {
      setStatus(`未知工作流预设 · ${presetId}`, 'error');
      return;
    }

    filesByNode.clear();
    execCache.clear();
    clearNodeExecutionStates(graph);
    clearNodeExecutionIgnored(graph);
    clearViewport();
    renderEmptyViewport();

    if (!entry.preset) {
      graph.clear();
      canvas.setDirty(true, true);
      setStatus('空白画布已载入', 'idle');
      return;
    }

    try {
      loadWorkflowPresetIntoLGraph(graph, entry.preset);
      canvas.setDirty(true, true);
      setStatus(
        `${entry.name} 已载入 · ${entry.preset.nodes.length} 个节点 · 请选择媒体文件`,
        'idle',
      );
    } catch (error) {
      setStatus(`预设载入失败 · ${String(error)}`, 'error');
    }
  }

  function setupFilePicker() {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file && pendingFileNode) assignFileToNode(pendingFileNode, file);
      pendingFileNode = null;
      fileInput.value = '';
    });
    document.body.appendChild(fileInput);
  }

  function assignFileToNode(node: LGraphNodeBase, file: File) {
    filesByNode.set(String(node.id), file);
    execCache.clear();
    clearViewport();
    renderEmptyViewport();
    if (node.fileWidget) {
      node.fileWidget.label = truncateFileName(file.name);
      node.fileWidget.value = file.name;
    }
    canvas.setDirty(true, true);
    setStatus(`File Loader #${node.id} 已选择 ${file.name}`, 'idle');
  }

  function openFilePickerForNode(node: LGraphNodeBase) {
    pendingFileNode = node;
    fileInput.click();
  }

  function buildPalette() {
    const list = document.getElementById('palette-list')!;
    list.innerHTML = '';
    document.getElementById('node-count')!.textContent = String(allNodes.length);

    const byCategory = nodesByCategory();

    for (const [category, nodes] of byCategory) {
      const group = document.createElement('div');
      group.className = 'category-group';

      const label = document.createElement('div');
      label.className = 'category-label';
      label.textContent = category;
      group.appendChild(label);

      for (const node of nodes) {
        const item = document.createElement('div');
        item.className = 'node-item';
        item.dataset.search = `${node.displayName} ${node.description ?? ''} ${node.category}`.toLowerCase();
        item.style.setProperty('--node-color', CATEGORY_COLORS[node.category] ?? '#8b93a7');
        item.title = node.description ?? node.displayName;
        item.draggable = true;
        item.innerHTML = `
          <span class="node-item__copy">
            <span class="node-item__name">${node.displayName}</span>
            <span class="node-item__description">${node.description ?? node.category}</span>
          </span>
        `;
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer!.setData('application/node-id', node.id);
        });
        item.addEventListener('dblclick', () => addNodeToCanvas(node.id));
        group.appendChild(item);
      }

      list.appendChild(group);
    }
  }

  function setupToolbar() {
    const loadInput = document.getElementById('load-workflow-input') as HTMLInputElement | null;
    document.getElementById('save-workflow-button')?.addEventListener('click', saveWorkflowToFile);
    document.getElementById('load-workflow-button')?.addEventListener('click', () => {
      loadInput?.click();
    });
    loadInput?.addEventListener('change', () => {
      const file = loadInput.files?.[0];
      loadInput.value = '';
      if (file) void loadWorkflowFromFile(file);
    });
    document.getElementById('run-workflow-button')?.addEventListener('click', () => {
      void runWorkflow();
    });
  }

  function setupThemeToggle() {
    const button = document.getElementById('theme-toggle-button') as HTMLButtonElement | null;
    if (!button) return;

    const syncButtonLabel = (theme: Theme) => {
      button.setAttribute('aria-label', theme === 'dark' ? '切换到浅色模式' : '切换到深色模式');
    };

    const currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    syncButtonLabel(currentTheme);
    applyCanvasTheme(currentTheme);

    button.addEventListener('click', () => {
      const nextTheme: Theme =
        document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = nextTheme;
      localStorage.setItem('media-workflow-theme', nextTheme);
      syncButtonLabel(nextTheme);
      applyCanvasTheme(nextTheme);
    });
  }

  function applyCanvasTheme(theme: Theme) {
    const canvasTheme = theme === 'light'
      ? { background: '#eef0f5', link: '#7b8191' }
      : { background: '#0c0e14', link: '#9aa1b3' };
    const themedCanvas = canvas as unknown as {
      clear_background_color: string;
      default_connection_color: string;
      setDirty(fg: boolean, bg: boolean): void;
    };
    themedCanvas.clear_background_color = canvasTheme.background;
    themedCanvas.default_connection_color = canvasTheme.link;
    themedCanvas.setDirty(true, true);
  }

  function setupNodeSearch() {
    const search = document.getElementById('node-search') as HTMLInputElement | null;
    if (!search) return;

    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      const groups = document.querySelectorAll<HTMLElement>('.category-group');

      for (const group of groups) {
        const items = group.querySelectorAll<HTMLElement>('.node-item');
        let visibleCount = 0;
        for (const item of items) {
          const isVisible = !query || item.dataset.search?.includes(query) === true;
          item.hidden = !isVisible;
          if (isVisible) visibleCount++;
        }
        group.hidden = visibleCount === 0;
      }
    });
  }

  function addNodeAtGraphPosition(nodeId: string, graphPos: [number, number]): void {
    const typeName = `media/${nodeId}`;
    const node = LiteGraph.createNode(typeName) as unknown as LGraphNodeBase & {
      id: number;
      pos: [number, number];
    };
    node.pos = [graphPos[0] - 60, graphPos[1] - 20];
    (graph as { add(node: unknown): void }).add(node);
    canvas.setDirty(true, true);
  }

  function addNodeToCanvas(nodeId: string) {
    addNodeAtGraphPosition(nodeId, [200 + Math.random() * 300, 100 + Math.random() * 200]);
  }

  function setupCanvasDrop(canvasWrap: HTMLElement) {
    canvasWrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
    });

    canvasWrap.addEventListener('drop', (e) => {
      e.preventDefault();

      if (e.dataTransfer?.files.length) {
        setStatus('请在 File Loader 节点内点击“选择文件”', 'error');
        return;
      }

      const nodeId = e.dataTransfer!.getData('application/node-id');
      if (nodeId) {
        const graphPos = canvas.convertEventToCanvasOffset(
          e as unknown as MouseEvent,
        ) as [number, number];
        addNodeAtGraphPosition(nodeId, graphPos);
      }
    });
  }

  function setupKeyboard() {
    document.addEventListener('keydown', async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        await runWorkflow();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveWorkflowToFile();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selected = (canvas as unknown as { selected_nodes?: Record<string, unknown> }).selected_nodes;
        if (selected && Object.keys(selected).length > 0) {
          for (const nodeId of Object.keys(selected)) {
            const node = (graph as unknown as { _nodes: Array<{ id: string }> })._nodes.find(
              n => String(n.id) === nodeId,
            );
            if (node) {
              filesByNode.delete(String(node.id));
              (graph as { remove(node: unknown): void }).remove(node);
            }
          }
          canvas.setDirty(true, true);
        }
      }
    });
  }

  async function runWorkflow() {
    if (isRunning) return;

    const prepared = prepareWorkflowExecution();
    if (!prepared) return;

    const {
      workflow,
      runnableNodeIds,
      skipSummary,
    } = prepared;

    const signal = new AbortController().signal;
    clearNodeExecutionStates(graph);
    clearViewport();
    isRunning = true;
    setRunButtonDisabled(true);
    startExecutionAnimation(canvas);

    setStatus(
      skipSummary
        ? `正在执行 ${runnableNodeIds.size} 个节点（${skipSummary}）…`
        : `正在执行 ${runnableNodeIds.size} 个节点…`,
      'running',
    );

    try {
      const results = await executeGraph(
        workflow,
        execCache,
        signal,
        event => handleExecutionEvent(event, skipSummary),
        { runnableNodeIds },
      );

      const successMessage = skipSummary
        ? `执行完成 · ${results.size} 个节点 · ${skipSummary}`
        : `执行完成 · ${results.size} 个节点 · ${workflow.edges.length} 条连线`;
      setStatus(successMessage, 'success');
    } catch (err) {
      setStatus(`执行失败 · ${String(err)}`, 'error');
      canvas.setDirty(true, true);
    } finally {
      isRunning = false;
      setRunButtonDisabled(false);
      stopExecutionAnimation();
      canvas.setDirty(true, true);
    }
  }

  function prepareWorkflowExecution():
    | {
      workflow: ReturnType<typeof extractWorkflowFromLGraph>['graph'];
      nodeTypes: Map<string, string>;
      runnableNodeIds: Set<string>;
      skipSummary: string | undefined;
    }
    | undefined {
    const { graph: workflow, nodeTypes } = extractWorkflowFromLGraph(graph, {
      getFileForNode: nodeId => filesByNode.get(nodeId),
    });

    if (workflow.nodes.size === 0) {
      setStatus('画布中没有可执行节点', 'error');
      return undefined;
    }

    const ignoredNodeIds = collectIgnoredNodeIds(graph);
    const { runnableNodeIds, skippedNodeIds } = analyzeRunnableWorkflow(workflow, {
      ignoredNodeIds,
    });
    if (runnableNodeIds.size === 0) {
      setStatus('没有可执行的节点流程 · 请检查必填连线是否连通', 'error');
      return undefined;
    }

    const missingFileLoaders = [...nodeTypes]
      .filter(([nodeId, nodeType]) =>
        nodeType === 'file_loader' &&
        runnableNodeIds.has(nodeId) &&
        !filesByNode.has(nodeId),
      )
      .map(([nodeId]) => `File Loader #${nodeId}`);
    if (missingFileLoaders.length > 0) {
      for (const label of missingFileLoaders) {
        const match = label.match(/#(\d+)$/);
        if (match?.[1]) {
          markNodeExecutionFailed(graph, match[1], '未选择文件');
        }
      }
      canvas.setDirty(true, true);
      setStatus(`请在节点内选择文件 · ${missingFileLoaders.join('、')}`, 'error');
      return undefined;
    }

    const skippedCount = skippedNodeIds.size;
    const ignoredCount = ignoredNodeIds.size;
    const skipSummary = buildExecutionSkipSummary(skippedCount, ignoredCount) ?? undefined;

    return { workflow, nodeTypes, runnableNodeIds, skipSummary };
  }

  function handleExecutionEvent(
    event: NodeExecutionEvent,
    skipSummary: string | undefined,
  ) {
    if (event.status === 'started') {
      markNodeExecutionRunning(graph, event.nodeId);
      canvas.setDirty(true, true);
      setStatus(
        skipSummary
          ? `正在执行 · ${event.node.displayName}（${skipSummary}）`
          : `正在执行 · ${event.node.displayName}`,
        'running',
      );
      return;
    }

    clearNodeExecutionRunning(graph, event.nodeId);

    if (event.status === 'failed') {
      const failedNode = markNodeExecutionFailed(
        graph,
        event.nodeId,
        event.error?.message,
      );
      if (failedNode) {
        (canvas as unknown as { centerOnNode(node: unknown): void }).centerOnNode(failedNode);
      }
      canvas.setDirty(true, true);
    }

    renderExecutionEvent(event);
    updateDisplayNodePreview(event);
    updateFrameSelectorNodePreview(event);

    if (event.status === 'failed') {
      setStatus(
        `执行失败 · ${event.node.displayName} · ${event.error?.message ?? 'Unknown error'}`,
        'error',
      );
      return;
    }
  }

  function saveWorkflowToFile() {
    const preset = exportWorkflowPresetFromLGraph(graph);
    const json = JSON.stringify(preset, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `media-workflow-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(
      `工作流已保存到本地 · ${preset.nodes.length} 个节点 · ${preset.edges.length} 条连线`,
      'success',
    );
  }

  async function loadWorkflowFromFile(file: File): Promise<void> {
    try {
      const preset = parseWorkflowPreset(await file.text());
      filesByNode.clear();
      execCache.clear();
      clearNodeExecutionStates(graph);
      clearNodeExecutionIgnored(graph);
      clearViewport();
      renderEmptyViewport();
      loadWorkflowPresetIntoLGraph(graph, preset);
      canvas.setDirty(true, true);
      setStatus(
        `${preset.name} 已从本地载入 · ${preset.nodes.length} 个节点 · 请重新选择媒体文件`,
        'success',
      );
    } catch (error) {
      setStatus(`加载工作流失败 · ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  function setStatus(msg: string, state: StatusState = 'idle') {
    const el = document.getElementById('status-text');
    if (el) el.textContent = msg;
    document.getElementById('status')?.setAttribute('data-state', state);
  }

  function updateFrameSelectorNodePreview(event: NodeExecutionEvent) {
    if (event.status === 'started') return;
    if (!TIMELINE_NODE_IDS.has(event.node.id)) return;
    const node = (graph as unknown as { _nodes: FrameSelectorNode[] })._nodes.find(
      candidate => String(candidate.id) === event.nodeId,
    );
    if (!node) return;
    updateFrameSelectorPreviewFromEvent(node, event);
    canvas.setDirty(true, true);
  }

  function updateDisplayNodePreview(event: NodeExecutionEvent) {
    if (event.status === 'started') {
      if (
        event.node.category !== 'display' &&
        event.node.category !== 'inspect' &&
        event.node.id !== 'file_export'
      ) {
        return;
      }
      const node = (graph as unknown as { _nodes: LGraphNodeBase[] })._nodes.find(
        candidate => String(candidate.id) === event.nodeId,
      );
      if (!node) return;
      node.displayPreview = summarizeDisplayEvent(event);
      canvas.setDirty(true, true);
      return;
    }

    if (
      event.node.category !== 'display' &&
      event.node.category !== 'inspect' &&
      event.node.id !== 'file_export'
    ) {
      return;
    }
    const node = (graph as unknown as { _nodes: LGraphNodeBase[] })._nodes.find(
      candidate => String(candidate.id) === event.nodeId,
    );
    if (!node) return;
    node.displayPreview = summarizeDisplayEvent(event);
    node.displayCanvas = event.node.id === 'video_preview'
      ? createYuvDisplayCanvas(event)
      : undefined;
    canvas.setDirty(true, true);
  }

  function setRunButtonDisabled(disabled: boolean) {
    const button = document.getElementById('run-workflow-button') as HTMLButtonElement | null;
    if (!button) return;
    button.disabled = disabled;
    button.setAttribute('aria-busy', String(disabled));
  }

  function renderEmptyViewport() {
    const viewport = document.getElementById('viewport');
    if (!viewport) return;
    viewport.innerHTML = `
      <div class="viewport-empty">
        <div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M4 19V5M4 12h5l2-4 3 8 2-4h4"/>
          </svg>
          <div>运行工作流后，分析结果会显示在这里</div>
        </div>
      </div>
    `;
  }

  function truncateFileName(fileName: string): string {
    if (fileName.length <= 22) return fileName;
    const extensionIndex = fileName.lastIndexOf('.');
    const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : '';
    return `${fileName.slice(0, Math.max(10, 18 - extension.length))}…${extension}`;
  }

  return { mount };
}

function getSelectedCanvasNodeIds(canvas: LGraphCanvas): string[] {
  const selected = (canvas as unknown as { selected_nodes?: Record<string, unknown> }).selected_nodes;
  if (!selected) return [];
  return Object.keys(selected);
}

function parseWorkflowPreset(text: string): WorkflowPreset {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.version !== 1 || typeof value.name !== 'string') {
    throw new Error('文件不是受支持的工作流 JSON');
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('工作流缺少 nodes 或 edges');
  }
  for (const node of value.nodes) {
    if (!isRecord(node) || typeof node.id !== 'string' || typeof node.type !== 'string') {
      throw new Error('工作流包含无效节点');
    }
  }
  for (const edge of value.edges) {
    if (
      !isRecord(edge) ||
      typeof edge.id !== 'string' ||
      typeof edge.sourceNodeId !== 'string' ||
      typeof edge.sourceOutput !== 'string' ||
      typeof edge.targetNodeId !== 'string' ||
      typeof edge.targetInput !== 'string'
    ) {
      throw new Error('工作流包含无效连线');
    }
  }
  return value as unknown as WorkflowPreset;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildExecutionSkipSummary(skippedCount: number, ignoredCount: number): string | null {
  const parts: string[] = [];
  if (ignoredCount > 0) {
    parts.push(`${ignoredCount} 个已忽略`);
  }
  const disconnectedCount = Math.max(0, skippedCount - ignoredCount);
  if (disconnectedCount > 0) {
    parts.push(`${disconnectedCount} 个未连通`);
  }
  if (parts.length === 0) return null;
  return `跳过 ${parts.join('，')}`;
}

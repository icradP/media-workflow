/**
 * ComfyUI-style 画布绑定 — 节点注册 + 拖拽 + 执行
 */

import { LGraph, LGraphCanvas, LiteGraph } from 'litegraph.js';
import { nodesByCategory, allNodes } from '@media-workflow/nodes';
import { graphToJSON, createMemoryCache, executeGraph } from '@media-workflow/core';
import type { ExecutionCache, NodeExecutionEvent } from '@media-workflow/core';
import { extractWorkflowFromLGraph } from './graph_adapter.js';
import { clearViewport, renderExecutionEvent } from './viewport.js';

// ─── Pin type → LiteGraph color ───

const PIN_COLORS: Record<string, string> = {
  buffer: '#4ecdc4',
  media_source: '#4ecdc4',
  media_probe: '#8b93a7',
  media_asset: '#ff6b6b',
  track_list: '#a29bfe',
  media_track: '#7c5cff',
  media_samples: '#feca57',
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

const CATEGORY_COLORS: Record<string, string> = {
  source: '#4ecdc4',
  parser: '#7c5cff',
  demux: '#ff9f43',
  decoder: '#54a0ff',
  analysis: '#f368e0',
  display: '#feca57',
  utility: '#8b93a7',
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
  properties: Record<string, unknown>;
  onExecute?: () => void;
  onDrawForeground?: (context: CanvasRenderingContext2D) => void;
  pos: [number, number];
  size: [number, number];
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

export function registerNodeTypes(options: RegisterNodeTypeOptions = {}) {
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
      type: def.type,
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
      for (const [paramName, param] of Object.entries(nodeDef.params ?? {})) {
        this.properties[paramName] = param.default;
        const widgetType = param.type === 'boolean'
          ? 'toggle'
          : param.type === 'enum'
            ? 'combo'
            : param.type === 'string'
              ? 'text'
              : 'number';
        const widgetOptions = param.type === 'enum'
          ? { values: param.values }
          : param.type === 'number'
            ? { min: param.min, max: param.max, step: param.step }
            : {};
        this.addWidget(widgetType, paramName, param.default, value => {
          this.properties[paramName] = value;
        }, widgetOptions);
      }
      if (nodeDef.category === 'display') {
        this.displayPreview = ['等待分析结果…'];
        this.onDrawForeground = context => drawDisplayPreview(this, context);
      }
      this.pos = [200, 200];
      this.size = [
        nodeDef.category === 'display' ? 260 : nodeDef.id === 'file_loader' ? 200 : 180,
        60 +
          Math.max(inputs.length, outputs.length) * 22 +
          (this.fileWidget ? 32 : 0) +
          Object.keys(nodeDef.params ?? {}).length * 32 +
          (nodeDef.category === 'display' ? 92 : 0),
      ];
      this.onExecute = () => {
        // Execution handled by @media-workflow/core scheduler
      };
    }

    NodeClass.prototype.constructor = NodeClass;
    NodeClass.prototype.title = nodeDef.displayName;

    LiteGraph.registerNodeType(typeName, NodeClass as never);
  }
}

function drawDisplayPreview(node: LGraphNodeBase, context: CanvasRenderingContext2D): void {
  const isLight = document.documentElement.dataset.theme === 'light';
  const panelHeight = 76;
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
  context.font = '10px ui-monospace, SFMono-Regular, monospace';
  context.fillStyle = isLight ? '#555e72' : '#aab2c5';
  lines.slice(0, 4).forEach((line, index) => {
    context.fillText(line, 16, panelY + 18 + index * 15);
  });
  context.restore();
}

function summarizeDisplayEvent(event: NodeExecutionEvent): string[] {
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
    const track = event.inputs.track as {
      trackId?: unknown;
      kind?: unknown;
      codec?: unknown;
      sampleCount?: unknown;
    } | undefined;
    return [
      String(track?.trackId ?? 'No track'),
      `${String(track?.kind ?? 'unknown')} · ${String(track?.codec ?? 'Unknown')}`,
      `${String(track?.sampleCount ?? 0)} samples`,
    ];
  }

  if (event.node.id === 'frame_table') {
    const samples = event.outputs.samples;
    return [
      `${Array.isArray(samples) ? samples.length : 0} samples`,
      'PTS / DTS / size / offset',
    ];
  }

  if (event.node.id === 'hex_view') {
    const preview = String(event.outputs.preview ?? '');
    return ['Hex preview', preview.slice(0, 46), preview.slice(46, 92)];
  }

  return [
    event.status === 'cached' ? '缓存命中' : '执行完成',
    `${event.durationMs.toFixed(1)} ms`,
  ];
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
    registerNodeTypes({ onRequestFile: openFilePickerForNode });

    graph = new LGraph();
    execCache = createMemoryCache();

    const canvasWrap = document.getElementById('canvas-wrap')!;
    const canvasElement = document.createElement('canvas');
    canvasElement.setAttribute('aria-label', '节点编辑画布');
    canvasWrap.prepend(canvasElement);
    canvas = new LGraphCanvas(canvasElement, graph);
    canvas.background_image = '';
    canvas.render_canvas_border = false;
    graph.start();

    setupFilePicker();
    buildPalette();
    setupToolbar();
    setupThemeToggle();
    setupNodeSearch();
    setupKeyboard();
    setupCanvasDrop(canvasWrap);

    renderEmptyViewport();
    loadDefaultWorkflow();
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
    document.getElementById('save-workflow-button')?.addEventListener('click', serializeAndLog);
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

  function addNodeToCanvas(nodeId: string) {
    const typeName = `media/${nodeId}`;
    const node = LiteGraph.createNode(typeName) as unknown as LGraphNodeBase & { id: number };
    node.pos = [200 + Math.random() * 300, 100 + Math.random() * 200];
    (graph as { add(node: unknown): void }).add(node);
    canvas.setDirty(true, true);
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
        const rect = canvasWrap.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const typeName = `media/${nodeId}`;
        const node = LiteGraph.createNode(typeName) as unknown as LGraphNodeBase & { id: number; pos: [number, number] };
        node.pos = [x - 60, y - 20];
        (graph as { add(node: unknown): void }).add(node);
        canvas.setDirty(true, true);
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
        serializeAndLog();
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

    const signal = new AbortController().signal;
    const { graph: workflow, nodeTypes } = extractWorkflowFromLGraph(graph, {
      getFileForNode: nodeId => filesByNode.get(nodeId),
    });

    if (workflow.nodes.size === 0) {
      setStatus('画布中没有可执行节点', 'error');
      return;
    }

    const disconnectedInputs = findDisconnectedRequiredInputs(workflow);
    if (disconnectedInputs.length > 0) {
      setStatus(`数据管道未连通 · ${disconnectedInputs.join('、')}`, 'error');
      return;
    }

    const missingFileLoaders = [...nodeTypes]
      .filter(([nodeId, nodeType]) => nodeType === 'file_loader' && !filesByNode.has(nodeId))
      .map(([nodeId]) => `File Loader #${nodeId}`);
    if (missingFileLoaders.length > 0) {
      setStatus(`请在节点内选择文件 · ${missingFileLoaders.join('、')}`, 'error');
      return;
    }

    clearViewport();
    isRunning = true;
    setRunButtonDisabled(true);
    setStatus(`正在执行 ${workflow.nodes.size} 个节点…`, 'running');

    try {
      const results = await executeGraph(workflow, execCache, signal, event => {
        renderExecutionEvent(event);
        updateDisplayNodePreview(event);
        setStatus(
          event.status === 'failed'
            ? `执行失败 · ${event.node.displayName}`
            : `正在执行 · ${event.node.displayName}`,
          event.status === 'failed' ? 'error' : 'running',
        );
      });

      setStatus(`执行完成 · ${results.size} 个节点 · ${workflow.edges.length} 条连线`, 'success');
    } catch (err) {
      setStatus(`执行失败 · ${String(err)}`, 'error');
    } finally {
      isRunning = false;
      setRunButtonDisabled(false);
    }
  }

  function serializeAndLog() {
    const { graph: workflow } = extractWorkflowFromLGraph(graph, {
      getFileForNode: nodeId => filesByNode.get(nodeId),
    });
    const json = graphToJSON(workflow);
    console.log('Workflow JSON:', json);
    setStatus(
      `工作流已序列化 · ${workflow.nodes.size} 个节点 · ${workflow.edges.length} 条连线`,
      'success',
    );
  }

  function loadDefaultWorkflow() {
    const nodeIds = ['file_loader', 'auto_analyze', 'stream_overview'];
    let x = 200;

    for (const id of nodeIds) {
      const typeName = `media/${id}`;
      const node = LiteGraph.createNode(typeName) as unknown as LGraphNodeBase & {
        id: number;
        pos: [number, number];
        connect(slot: number, target: LGraphNodeBase, targetSlot: number): void;
      };
      node.pos = [x, 200];
      (graph as { add(node: unknown): void }).add(node);
      x += 300;
    }

    const nodeList = (graph as unknown as {
      _nodes: Array<{ connect: (s: number, t: LGraphNodeBase, ts: number) => void }>;
    })._nodes;

    if (nodeList && nodeList.length >= 3) {
      nodeList[0]!.connect(0, nodeList[1] as unknown as LGraphNodeBase, 0);
      nodeList[1]!.connect(0, nodeList[2] as unknown as LGraphNodeBase, 0);
    }

    canvas.setDirty(true, true);
    setStatus('默认工作流已载入 · 请选择媒体文件', 'idle');
  }

  function setStatus(msg: string, state: StatusState = 'idle') {
    const el = document.getElementById('status-text');
    if (el) el.textContent = msg;
    document.getElementById('status')?.setAttribute('data-state', state);
  }

  function updateDisplayNodePreview(event: NodeExecutionEvent) {
    if (event.node.category !== 'display') return;
    const node = (graph as unknown as { _nodes: LGraphNodeBase[] })._nodes.find(
      candidate => String(candidate.id) === event.nodeId,
    );
    if (!node) return;
    node.displayPreview = summarizeDisplayEvent(event);
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

  function findDisconnectedRequiredInputs(
    workflow: ReturnType<typeof extractWorkflowFromLGraph>['graph'],
  ): string[] {
    const connectedInputs = new Set(
      workflow.edges.map(edge => `${edge.targetNodeId}:${edge.targetInput}`),
    );
    const disconnected: string[] = [];

    for (const [nodeId, node] of workflow.nodes) {
      for (const [inputName, input] of Object.entries(node.inputs)) {
        if (!input.optional && !connectedInputs.has(`${nodeId}:${inputName}`)) {
          disconnected.push(`${node.displayName}.${inputName}`);
        }
      }
    }

    return disconnected;
  }

  return { mount };
}

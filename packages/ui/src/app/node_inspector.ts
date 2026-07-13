import type { NodeDefinition, NodeParamDef } from '@media-workflow/core';
import type { LGraph, LGraphCanvas } from 'litegraph.js';
import { allNodes } from '@media-workflow/nodes';
import { formatFrameSelectorRange } from './frame_selector_ui.js';

const NODE_DEFS = new Map(allNodes.map(definition => [definition.id, definition]));

const PARAM_LABELS: Record<string, Record<string, string>> = {
  media_select: {
    trackId: '轨道 ID',
    kind: '轨道类型',
    trackIndex: '轨道序号',
    startIndex: '起始索引',
    endIndex: '结束索引',
    startTimeSeconds: '起始时间 (秒)',
    endTimeSeconds: '结束时间 (秒)',
    frameType: '帧类型',
    limit: '数量上限',
  },
  video_decode: {
    trackId: '轨道 ID',
    trackIndex: '轨道序号',
    startIndex: '起始索引',
    endIndex: '结束索引',
    startTimeSeconds: '起始时间 (秒)',
    endTimeSeconds: '结束时间 (秒)',
    frameType: '帧类型',
    limit: '数量上限',
    outputFormat: '输出像素格式',
  },
  audio_decode: {
    trackId: '轨道 ID',
    trackIndex: '轨道序号',
    startTimeSeconds: '起始时间 (秒)',
    endTimeSeconds: '结束时间 (秒)',
  },
  wav_player: {
    autoplay: '自动播放',
  },
  mp4_player: {
    autoplay: '自动播放',
  },
  mp4_muxer: {
    fileName: '文件名',
    includeVideo: '包含视频轨',
    includeAudio: '包含音频轨',
    videoTrackIndex: '视频轨序号',
    audioTrackIndex: '音频轨序号',
    startTimeSeconds: '起始时间 (秒)',
    endTimeSeconds: '结束时间 (秒)',
    alignMode: '音视频对齐',
  },
  aac_transcode: {
    trackId: '轨道 ID',
    trackIndex: '轨道序号',
    startTimeSeconds: '起始时间 (秒)',
    endTimeSeconds: '结束时间 (秒)',
    bitrate: '码率 (bps)',
  },
};

const TIMELINE_NODE_IDS = new Set(['media_select', 'video_decode', 'audio_decode', 'aac_transcode']);

const FRAME_TYPE_LABELS: Record<string, string> = {
  all: '全部',
  key: '关键帧',
  non_key: '非关键帧',
  I: 'I 帧',
  P: 'P 帧',
  B: 'B 帧',
  IDR: 'IDR 帧',
};

const ALIGN_MODE_LABELS: Record<string, string> = {
  none: '不裁剪（各轨保持原时长）',
  trim_to_video: '以视频时长裁剪音频',
  trim_to_audio: '以音频时长裁剪视频',
};

interface InspectorNodeLike {
  id: number;
  type: string;
  title: string;
  properties: Record<string, unknown>;
  widgets?: Array<{ name: string; value: unknown }>;
  frameSelectorPreview?: {
    sampleCount: number;
    durationSeconds: number;
    trackLabel: string;
  } | null;
}

export interface NodeInspectorOptions {
  getGraph: () => LGraph;
  getCanvas: () => LGraphCanvas;
  onParamChange?: (nodeId: string) => void;
}

export function initNodeInspector(options: NodeInspectorOptions): void {
  const host = document.querySelector('#properties .inspector-body');
  if (!host) return;

  const section = document.createElement('section');
  section.id = 'node-inspector';
  section.className = 'inspector-section inspector-section--node is-hidden';
  host.prepend(section);

  let selectedNodeId: string | null = null;
  const emptyState = document.getElementById('node-inspector-empty');

  const canvas = options.getCanvas() as LGraphCanvas & {
    onNodeSelected?: (node: InspectorNodeLike | null) => void;
    onNodeDeselected?: (node: InspectorNodeLike | null) => void;
  };

  canvas.onNodeSelected = node => {
    selectedNodeId = node ? String(node.id) : null;
    render();
  };

  canvas.onNodeDeselected = node => {
    if (node && String(node.id) === selectedNodeId) {
      selectedNodeId = null;
      render();
    }
  };

  document.addEventListener('media-workflow:node-params-changed', event => {
    const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
    if (!nodeId || nodeId !== selectedNodeId) return;
    render();
  });

  function render(): void {
    const node = findSelectedNode(options.getGraph(), selectedNodeId);
    if (!node) {
      section.classList.add('is-hidden');
      section.innerHTML = '';
      emptyState?.classList.remove('is-hidden');
      return;
    }

    const definition = resolveNodeDefinition(node);
    if (!definition) {
      section.classList.add('is-hidden');
      section.innerHTML = '';
      emptyState?.classList.remove('is-hidden');
      return;
    }

    section.classList.remove('is-hidden');
    emptyState?.classList.add('is-hidden');
    section.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'node-inspector__header';
    header.innerHTML = `
      <div>
        <div class="node-inspector__title">${escapeHtml(definition.displayName)}</div>
        <div class="node-inspector__meta">#${node.id} · ${escapeHtml(definition.category)}</div>
      </div>
    `;
    section.append(header);

    const summary = document.createElement('div');
    summary.className = 'node-inspector__summary';
    summary.textContent = summarizeNode(node, definition);
    section.append(summary);

    const form = document.createElement('form');
    form.className = 'node-inspector__form';
    form.addEventListener('submit', event => event.preventDefault());

    for (const [paramKey, param] of Object.entries(definition.params ?? {})) {
      form.append(createParamField(node, definition.id, paramKey, param, options.onParamChange));
    }

    if (!form.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'node-inspector__empty';
      empty.textContent = '该节点没有可编辑参数。';
      form.append(empty);
    }

    section.append(form);
  }
}

function findSelectedNode(
  graph: LGraph,
  nodeId: string | null,
): InspectorNodeLike | null {
  if (!nodeId) return null;
  return ((graph as unknown as { _nodes?: InspectorNodeLike[] })._nodes ?? [])
    .find(candidate => String(candidate.id) === nodeId) ?? null;
}

function resolveNodeDefinition(node: InspectorNodeLike): NodeDefinition | undefined {
  const definitionId = node.type.replace(/^media\//, '');
  return NODE_DEFS.get(definitionId);
}

function summarizeNode(node: InspectorNodeLike, definition: NodeDefinition): string {
  if (TIMELINE_NODE_IDS.has(definition.id)) {
    return `时间范围 ${formatFrameSelectorRange(node.properties, node.frameSelectorPreview)}`;
  }

  const params = Object.entries(definition.params ?? {});
  if (params.length === 0) {
    return definition.description ?? '已选中节点';
  }

  const preview = params
    .slice(0, 3)
    .map(([key, param]) => {
      const label = PARAM_LABELS[definition.id]?.[key] ?? param.name ?? key;
      return `${label}: ${formatParamValue(node.properties[key], param)}`;
    })
    .join(' · ');

  return preview || definition.description || '已选中节点';
}

function createParamField(
  node: InspectorNodeLike,
  definitionId: string,
  paramKey: string,
  param: NodeParamDef,
  onParamChange?: (nodeId: string) => void,
): HTMLElement {
  const field = document.createElement('label');
  field.className = 'node-inspector__field';

  const label = document.createElement('span');
  label.className = 'node-inspector__field-label';
  label.textContent = PARAM_LABELS[definitionId]?.[paramKey] ?? param.name ?? paramKey;
  field.append(label);

  const control = document.createElement(
    param.type === 'enum' ? 'select' : 'input',
  ) as HTMLInputElement | HTMLSelectElement;

  control.className = 'node-inspector__control';
  control.dataset.paramKey = paramKey;

  if (param.type === 'enum') {
    const select = control as HTMLSelectElement;
    for (const value of param.values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = enumOptionLabel(definitionId, paramKey, value) ?? value;
      select.append(option);
    }
    select.value = String(node.properties[paramKey] ?? param.default);
    select.addEventListener('change', () => {
      applyParamValue(node, paramKey, select.value, onParamChange);
    });
  } else {
    const input = control as HTMLInputElement;
    input.type = param.type === 'number' ? 'number' : param.type === 'boolean' ? 'checkbox' : 'text';
    if (param.type === 'number') {
      if (param.min !== undefined) input.min = String(param.min);
      if (param.max !== undefined) input.max = String(param.max);
      if (param.step !== undefined) input.step = String(param.step);
      input.value = String(node.properties[paramKey] ?? param.default);
    } else if (param.type === 'boolean') {
      input.checked = Boolean(node.properties[paramKey] ?? param.default);
    } else {
      input.value = String(node.properties[paramKey] ?? param.default);
    }

    input.addEventListener('change', () => {
      const value = param.type === 'boolean'
        ? input.checked
        : param.type === 'number'
          ? Number(input.value)
          : input.value;
      applyParamValue(node, paramKey, value, onParamChange);
    });
  }

  field.append(control);

  if (param.type === 'number' && (paramKey === 'endIndex' || paramKey === 'endTimeSeconds' || paramKey === 'limit')) {
    const note = document.createElement('span');
    note.className = 'node-inspector__field-note';
    note.textContent = '-1 表示无上限';
    field.append(note);
  }

  return field;
}

function applyParamValue(
  node: InspectorNodeLike,
  paramKey: string,
  value: unknown,
  onParamChange?: (nodeId: string) => void,
): void {
  node.properties[paramKey] = value;
  const widget = node.widgets?.find(candidate => candidate.name === paramKey);
  if (widget) widget.value = value;
  onParamChange?.(String(node.id));
  document.dispatchEvent(new CustomEvent('media-workflow:node-params-changed', {
    detail: { nodeId: String(node.id) },
  }));
}

function formatParamValue(value: unknown, param: NodeParamDef): string {
  if (param.type === 'enum') {
    return enumOptionLabel('', param.name, String(value)) ??
      FRAME_TYPE_LABELS[String(value)] ??
      String(value);
  }
  if (param.type === 'boolean') {
    return value ? '是' : '否';
  }
  return String(value ?? param.default);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function enumOptionLabel(
  definitionId: string,
  paramKey: string,
  value: string,
): string | undefined {
  if (paramKey === 'alignMode') return ALIGN_MODE_LABELS[value];
  return FRAME_TYPE_LABELS[value];
}

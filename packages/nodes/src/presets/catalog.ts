import type { WorkflowPreset } from '../preset.js';
import quickOverviewPreset from '../../presets/quick-overview.workflow.json';
import ffprobeOverviewPreset from '../../presets/ffprobe-overview.workflow.json';
import ffprobeVideoTrackPreset from '../../presets/ffprobe-video-track.workflow.json';
import ffprobeAudioTrackPreset from '../../presets/ffprobe-audio-track.workflow.json';
import decodeFirstKeyframePreset from '../../presets/decode-first-keyframe.workflow.json';
import decodeAudioRangePreset from '../../presets/decode-audio-range.workflow.json';

export interface WorkflowPresetCatalogEntry {
  id: string;
  name: string;
  description: string;
  preset: WorkflowPreset | null;
}

export const WORKFLOW_PRESET_CATALOG: WorkflowPresetCatalogEntry[] = [
  {
    id: 'blank',
    name: '空白画布',
    description: '清空画布，从零开始搭建工作流。',
    preset: null,
  },
  {
    id: 'quick-overview',
    name: '快速概览',
    description: '文件 → 自动分析 → 流概览。',
    preset: quickOverviewPreset as WorkflowPreset,
  },
  {
    id: 'ffprobe-overview',
    name: 'FFprobe 全量概览',
    description: '容器、轨道、全部 sample 表与原始 hex 预览。',
    preset: ffprobeOverviewPreset as WorkflowPreset,
  },
  {
    id: 'ffprobe-video-track',
    name: 'FFprobe 视频轨',
    description: '选择第一路视频轨，查看首个关键帧字节。',
    preset: ffprobeVideoTrackPreset as WorkflowPreset,
  },
  {
    id: 'ffprobe-audio-track',
    name: 'FFprobe 音频轨',
    description: '选择第一路音频轨，查看前 50 帧字节。',
    preset: ffprobeAudioTrackPreset as WorkflowPreset,
  },
  {
    id: 'decode-first-keyframe',
    name: '视频关键帧解码规划',
    description: '规划首个关键帧 GOP 解码请求（不含解码器节点）。',
    preset: decodeFirstKeyframePreset as WorkflowPreset,
  },
  {
    id: 'decode-audio-range',
    name: '音频片段解码规划',
    description: '规划 5 秒 AAC 音频解码范围（不含解码器节点）。',
    preset: decodeAudioRangePreset as WorkflowPreset,
  },
];

export const DEFAULT_WORKFLOW_PRESET_ID = 'quick-overview';

export function findWorkflowPresetEntry(
  presetId: string,
): WorkflowPresetCatalogEntry | undefined {
  return WORKFLOW_PRESET_CATALOG.find(entry => entry.id === presetId);
}

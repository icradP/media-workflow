import type { WorkflowPreset } from '../preset.js';
import quickOverviewPreset from '../../presets/quick-overview.workflow.json';
import ffprobeOverviewPreset from '../../presets/ffprobe-overview.workflow.json';
import ffprobeVideoTrackPreset from '../../presets/ffprobe-video-track.workflow.json';
import ffprobeAudioTrackPreset from '../../presets/ffprobe-audio-track.workflow.json';
import decodeFirstKeyframePreset from '../../presets/decode-first-keyframe.workflow.json';
import decodeFirstKeyframeDisplayPreset from '../../presets/decode-first-keyframe-display.workflow.json';
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
    name: '媒体结构概览',
    description: '容器、首轨 sample 选择与原始 hex 预览。',
    preset: ffprobeOverviewPreset as WorkflowPreset,
  },
  {
    id: 'ffprobe-video-track',
    name: '专业视频选择',
    description: '显式选轨和选帧，并查看关键帧表与压缩字节。',
    preset: ffprobeVideoTrackPreset as WorkflowPreset,
  },
  {
    id: 'ffprobe-audio-track',
    name: '专业音频选择',
    description: '显式选轨和时间范围，并查看音频 sample 与字节。',
    preset: ffprobeAudioTrackPreset as WorkflowPreset,
  },
  {
    id: 'decode-first-keyframe',
    name: '首个视频关键帧选择',
    description: '生成可复用于检查、解码和导出的 MediaSelection。',
    preset: decodeFirstKeyframePreset as WorkflowPreset,
  },
  {
    id: 'decode-first-keyframe-display',
    name: '首帧解码预览',
    description: '完整链路：分析 → 规划 → WebCodecs 解码 → YUV 预览。',
    preset: decodeFirstKeyframeDisplayPreset as WorkflowPreset,
  },
  {
    id: 'decode-audio-range',
    name: '音频片段解码导出',
    description: '直接解码前 5 秒音频并导出 WAV。',
    preset: decodeAudioRangePreset as WorkflowPreset,
  },
];

export const DEFAULT_WORKFLOW_PRESET_ID = 'quick-overview';

export function findWorkflowPresetEntry(
  presetId: string,
): WorkflowPresetCatalogEntry | undefined {
  return WORKFLOW_PRESET_CATALOG.find(entry => entry.id === presetId);
}

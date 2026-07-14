import type { WorkflowPreset } from '../preset.js';
import quickOverviewPreset from '../../presets/quick-overview.workflow.json';
import ffprobeOverviewPreset from '../../presets/ffprobe-overview.workflow.json';
import ffprobeVideoTrackPreset from '../../presets/ffprobe-video-track.workflow.json';
import ffprobeAudioTrackPreset from '../../presets/ffprobe-audio-track.workflow.json';
import decodeFirstKeyframePreset from '../../presets/decode-first-keyframe.workflow.json';
import decodeFirstKeyframeDisplayPreset from '../../presets/decode-first-keyframe-display.workflow.json';
import decodeAudioRangePreset from '../../presets/decode-audio-range.workflow.json';
import remuxMp4SelectionsPreset from '../../presets/remux-mp4-selections.workflow.json';
import remuxDualSourceMp4Preset from '../../presets/remux-dual-source-mp4.workflow.json';
import captureRecordMp4Preset from '../../presets/capture-record-mp4.workflow.json';
import realtimeAudioPlaybackPreset from '../../presets/realtime-audio-playback.workflow.json';
import realtimeVideoPlaybackPreset from '../../presets/realtime-video-playback.workflow.json';
import staticToLiveStreamPreset from '../../presets/ring-buffer-live.workflow.json';
import liveCapturePlaybackPreset from '../../presets/live-capture-playback.workflow.json';
import liveCaptureRecordMp4Preset from '../../presets/live-capture-record-mp4.workflow.json';

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
    name: '音频片段解码播放',
    description: '直接解码前 5 秒音频，播放并导出 WAV。',
    preset: decodeAudioRangePreset as WorkflowPreset,
  },
  {
    id: 'realtime-audio-playback',
    name: '实时音频处理',
    description:
      '解码 PCM → Web Audio 滤波（Live 监听）→ 烘培回 PCM → WAV。运行导出；Live 试听调参。',
    preset: realtimeAudioPlaybackPreset as WorkflowPreset,
  },
  {
    id: 'realtime-video-playback',
    name: '实时视频播放',
    description:
      '选段 → EncodedTrack → Ring（stream WebCodecs · 短解码窗口）→ Video Preview。运行只物化编码包；Live Play 按帧率绘制。',
    preset: realtimeVideoPlaybackPreset as WorkflowPreset,
  },
  {
    id: 'static-to-live-stream',
    name: 'Ring Buffer 直播源',
    description:
      '解码 PCM → Ring Buffer（static_once）→ 滤波 → Destination。运行填环；Live Play 按速率消费。',
    preset: staticToLiveStreamPreset as WorkflowPreset,
  },
  {
    id: 'live-capture-playback',
    name: '实时采集播放',
    description:
      '摄像头+麦克风 → Ring Buffer（continuous）→ Video Preview + Gain/滤波/扬声器。Live Play 实时 A/V（建议耳机）。',
    preset: liveCapturePlaybackPreset as WorkflowPreset,
  },
  {
    id: 'live-capture-record-mp4',
    name: '实时采集录制 MP4',
    description:
      'Live Play 监听；Trigger → Muxer recordStart/Stop 门控录制 → Player/Export。',
    preset: liveCaptureRecordMp4Preset as WorkflowPreset,
  },
  {
    id: 'capture-record-mp4',
    name: '摄像头采集封装',
    description: '采集摄像头与麦克风，编码 H.264/AAC，封装 MP4 并播放、导出。',
    preset: captureRecordMp4Preset as WorkflowPreset,
  },
  {
    id: 'remux-mp4-selections',
    name: 'MP4 选段封装',
    description: '分别选择视频/音频范围，封装 MP4 并播放、导出。',
    preset: remuxMp4SelectionsPreset as WorkflowPreset,
  },
  {
    id: 'remux-dual-source-mp4',
    name: '双源封装 MP4',
    description:
      '媒体 A 抽视频轨 + 媒体 B 抽音频轨 → Mux 新 MP4。适合采集 MP4 + 另一音频源合成。',
    preset: remuxDualSourceMp4Preset as WorkflowPreset,
  },
];

export const DEFAULT_WORKFLOW_PRESET_ID = 'quick-overview';

export function findWorkflowPresetEntry(
  presetId: string,
): WorkflowPresetCatalogEntry | undefined {
  return WORKFLOW_PRESET_CATALOG.find(entry => entry.id === presetId);
}

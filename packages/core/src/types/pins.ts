/**
 * Pin 类型 — 节点间数据连线的类型系统
 *
 * 每种 PinType 对应 PinDataMap 中的一个数据载体接口。
 * 连线时通过检查两端 PinType 是否兼容来决定是否可以连接。
 */

import type {
  BufferData,
  MediaSource,
  MediaProbe,
  MediaAsset,
  MediaTrack,
  MediaSample,
  MediaAnalysisResult,
  StreamInfo,
  FrameInfo,
  CompressedFrame,
  VideoFrameData,
  AudioBufferData,
  NalUnitData,
  DetectionResult,
  SeiPayloadData,
} from './carriers.js';

// ─── 标量类型 (参数配置，非大块数据) ───

export type ScalarPinType = 'number' | 'string' | 'boolean' | 'enum';

// ─── 数据载体类型 (大块数据，走引用/Transferable 传递) ───

export type DataPinType =
  | 'buffer'
  | 'media_source'
  | 'media_probe'
  | 'media_asset'
  | 'track_list'
  | 'media_track'
  | 'media_samples'
  | 'media'
  | 'stream'
  | 'frames'
  | 'compressed'
  | 'video_frame'
  | 'audio_buffer'
  | 'nal_units'
  | 'detections'
  | 'sei_payload';

// ─── 联合类型 ───

export type PinType = ScalarPinType | DataPinType;

/**
 * PinType → 数据载体 TS 接口的映射表。
 * 不直接导出值，作为类型层面的约束——确保每个 PinType 都有对应的数据结构。
 */
export interface PinDataMap {
  // ─── 大块数据 ───
  buffer: BufferData;
  media_source: MediaSource;
  media_probe: MediaProbe;
  media_asset: MediaAsset;
  track_list: MediaTrack[];
  media_track: MediaTrack;
  media_samples: MediaSample[];
  media: MediaAnalysisResult;
  stream: StreamInfo;
  frames: FrameInfo[];
  compressed: CompressedFrame;
  video_frame: VideoFrameData;
  audio_buffer: AudioBufferData;
  nal_units: NalUnitData;
  detections: DetectionResult;
  sei_payload: SeiPayloadData;
  // ─── 标量 ───
  number: number;
  string: string;
  boolean: boolean;
  enum: string;
}

/**
 * 根据 PinType 查询对应的 TypeScript 类型。
 *
 * @example
 * type T = PinValue<'compressed'>;  // CompressedFrame
 */
export type PinValue<T extends PinType> = PinDataMap[T];

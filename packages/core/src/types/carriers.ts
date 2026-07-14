/**
 * 数据载体接口 — 每种 Pin 类型对应的 TS interface
 *
 * 这些接口定义了在工作流节点之间流动的数据结构。
 * 大块数据（planes、data）通过 Transferable 跨 Worker 传递时走所有权移交，
 * 由 ResourceTracker 管理生命周期。
 */

// ─── buffer ───

export interface BufferData {
  /** 原始字节 */
  data: Uint8Array;
  /** 在整个文件/流中的起始偏移 */
  byteOffset: number;
  /** data 的有效长度 (≤ data.byteLength) */
  byteLength: number;
}

// ─── canonical media model ───

export type MediaSourceKind = 'file' | 'url' | 'memory' | 'stream';

/** Immutable input identity and byte payload for one analysis run. */
export interface MediaSource {
  sourceId: string;
  version: string;
  kind: MediaSourceKind;
  name: string;
  mimeType?: string;
  size: number;
  data: Uint8Array;
  metadata: Record<string, unknown>;
}

export interface MediaDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

export interface MediaProbeCandidate {
  format: DetectedMediaFormat;
  confidence: number;
  reason: string;
}

export type DetectedMediaFormat =
  | 'flv'
  | 'mpegts'
  | 'mpegps'
  | 'mp4'
  | 'wav'
  | 'flac'
  | 'mp3'
  | 'opus'
  | 'unknown';

export interface MediaProbe {
  sourceId: string;
  format: DetectedMediaFormat;
  confidence: number;
  candidates: MediaProbeCandidate[];
  diagnostics: MediaDiagnostic[];
}

export interface MediaContainer {
  format: DetectedMediaFormat;
  longName: string;
  durationUs?: number;
  bitrate?: number;
  metadata: Record<string, unknown>;
}

export type CodecFamily =
  | 'h264'
  | 'h265'
  | 'aac'
  | 'g711'
  | 'mp3'
  | 'opus'
  | 'pcm'
  | 'unknown';

export interface MediaTimeBase {
  numerator: number;
  denominator: number;
}

interface MediaTrackBase {
  trackId: string;
  index: number;
  kind: 'video' | 'audio' | 'data';
  codec: string;
  codecFamily: CodecFamily;
  codecConfig: Uint8Array | null;
  decoderConfig?: DecoderConfig;
  timeBase?: MediaTimeBase;
  durationUs?: number;
  bitrate?: number;
  sampleCount: number;
  language?: string;
  metadata: Record<string, unknown>;
}

export interface VideoMediaTrack extends MediaTrackBase {
  kind: 'video';
  width?: number;
  height?: number;
  profile?: string;
  level?: string;
  bitDepth?: number;
  chromaFormat?: string;
  frameRate?: number;
}

export interface AudioMediaTrack extends MediaTrackBase {
  kind: 'audio';
  sampleRate?: number;
  channels?: number;
  channelLayout?: string;
  profile?: string;
  samplesPerFrame?: number;
}

export interface DataMediaTrack extends MediaTrackBase {
  kind: 'data';
}

export type MediaTrack = VideoMediaTrack | AudioMediaTrack | DataMediaTrack;

export interface MediaSample {
  sampleId: string;
  index: number;
  trackId: string;
  ptsUs: number;
  dtsUs: number;
  durationUs?: number;
  offset: number;
  size: number;
  isKey: boolean;
  pictureType?: string;
  /** Zero-copy view of the encoded/container bytes when available. */
  data?: Uint8Array;
  metadata: Record<string, unknown>;
}

export interface MediaAsset {
  source: MediaSource;
  probe: MediaProbe;
  container: MediaContainer;
  tracks: MediaTrack[];
  samples: MediaSample[];
  metadata: Record<string, unknown>;
  diagnostics: MediaDiagnostic[];
  analyzedAt: string;
  analysisDurationMs: number;
}

export type MediaSampleOrder = 'presentation' | 'decode';

export type MediaFrameFilter =
  | 'all'
  | 'key'
  | 'non_key'
  | 'I'
  | 'P'
  | 'B'
  | 'IDR';

export interface MediaSelectionCriteria {
  startIndex: number;
  endIndex?: number;
  startTimeUs: number;
  endTimeUs?: number;
  frameType: MediaFrameFilter;
  limit?: number;
  order: MediaSampleOrder;
}

/**
 * A track bound to its originating asset and ordered samples.
 *
 * This is the canonical output of track selection. Keeping the asset context
 * removes the parallel asset+track wires that previously appeared throughout
 * the graph.
 */
export interface SelectedTrack {
  selectedTrackId: string;
  asset: MediaAsset;
  track: MediaTrack;
  samples: MediaSample[];
  diagnostics: MediaDiagnostic[];
}

/**
 * A materialized, deterministic sample selection.
 *
 * Both explicit selection nodes and convenience decode tasks produce/consume
 * this carrier, so inspection and decode paths share exactly one selection
 * interpretation.
 */
export interface MediaSelection {
  selectionId: string;
  selectedTrack: SelectedTrack;
  samples: MediaSample[];
  rangeStartUs: number;
  rangeEndUs?: number;
  criteria: MediaSelectionCriteria;
  diagnostics: MediaDiagnostic[];
}

// ─── decode / encode pipeline ───

export type BitstreamFormat =
  | 'avcc'
  | 'annexb'
  | 'aac_raw'
  | 'adts'
  | 'g711_alaw'
  | 'g711_ulaw'
  | 'mp3'
  | 'unknown';

export interface DecoderConfig {
  codec: string;
  codecFamily: CodecFamily;
  description?: Uint8Array;
  bitstreamFormat: BitstreamFormat;
  codedWidth?: number;
  codedHeight?: number;
  sampleRate?: number;
  channels?: number;
  metadata: Record<string, unknown>;
}

export interface EncodedPacket {
  packetId: string;
  sourceSampleId: string;
  trackId: string;
  codecFamily: CodecFamily;
  bitstreamFormat: BitstreamFormat;
  data: Uint8Array;
  ptsUs: number;
  dtsUs: number;
  durationUs?: number;
  isKey: boolean;
  metadata: Record<string, unknown>;
}

export interface VideoDecodeRequest {
  requestId: string;
  track: VideoMediaTrack;
  decoderConfig: DecoderConfig;
  decodePackets: EncodedPacket[];
  targetSampleIds: string[];
  diagnostics: MediaDiagnostic[];
}

export interface AudioDecodeRequest {
  requestId: string;
  track: AudioMediaTrack;
  decoderConfig: DecoderConfig;
  decodePackets: EncodedPacket[];
  rangeStartUs: number;
  rangeEndUs: number;
  diagnostics: MediaDiagnostic[];
}

export type DecodedVideoPixelFormat = 'I420' | 'NV12' | 'RGBA8' | 'BGRA8';

export interface DecodedVideoFrame {
  frameId: string;
  sourceSampleId: string;
  ptsUs: number;
  durationUs?: number;
  codedWidth: number;
  codedHeight: number;
  displayWidth: number;
  displayHeight: number;
  format: DecodedVideoPixelFormat;
  planes: Uint8Array[];
  strides: number[];
  colorSpace?: {
    primaries?: string;
    transfer?: string;
    matrix?: string;
    fullRange?: boolean;
  };
  metadata: Record<string, unknown>;
}

export interface DecodedVideoClip {
  requestId: string;
  selectionId?: string;
  backend: DecoderBackendInfo;
  frames: DecodedVideoFrame[];
  diagnostics: MediaDiagnostic[];
}

/** @deprecated Use DecodedVideoClip. */
export type DecodedVideoFrameSet = DecodedVideoClip;

export interface PcmAudioClip {
  clipId: string;
  selectionId?: string;
  sourceTrackId: string;
  ptsUs: number;
  durationUs: number;
  sampleRate: number;
  channels: number;
  sampleCount: number;
  format: 'f32-planar';
  planes: Float32Array[];
  channelLayout?: string;
  backend: DecoderBackendInfo;
  diagnostics: MediaDiagnostic[];
}

/** Descriptor for a Web Audio graph node; the native AudioNode lives in the Live session. */
export type WebAudioNodeKind =
  | 'source'
  | 'stream_source'
  | 'gain'
  | 'biquadfilter'
  | 'analyser'
  | 'destination'
  | 'to_pcm';

/** One stage in a serial webaudio processing chain (for Offline bake → pcm_audio). */
export interface WebAudioChainStep {
  kind: WebAudioNodeKind;
  nodeDefinitionId: string;
  params: Record<string, unknown>;
}

export interface WebAudioHandle {
  handleId: string;
  kind: WebAudioNodeKind;
  nodeDefinitionId: string;
  label?: string;
  params: Record<string, unknown>;
  /** Upstream stages + this stage, used by webaudio_to_pcm Offline rendering. */
  chain: WebAudioChainStep[];
}

/**
 * Live-capable stream descriptor. Native MediaStream is owned by the Live session,
 * not stored on the pin (same pattern as webaudio ↔ AudioNode).
 */
export type LiveStreamOrigin = 'static' | 'device' | 'remote';
export type LiveStreamMediaKind = 'audio' | 'video' | 'av';

/** How the ring is filled: one-shot static load vs continuous live push. */
export type RingFillMode = 'static_once' | 'continuous';
/** Who drives the clock / data flow. */
export type RingIoMode = 'producer_push' | 'consumer_pull';
/** Wall-clock realtime vs explicit rate clock. */
export type RingClockMode = 'realtime' | 'fixed_rate';
export type RingUnderrunPolicy = 'silence' | 'wait' | 'loop';
export type RingOverrunPolicy = 'drop_oldest' | 'block_producer' | 'drop_newest';

/** Common ring-buffer clock / pacing configuration (Live session owns native buffers). */
export interface RingBufferConfig {
  fillMode: RingFillMode;
  ioMode: RingIoMode;
  clockMode: RingClockMode;
  /** Clock multiplier (playback rate) relative to 1x. */
  rate: number;
  /** Target audio sample rate; 0 = follow source. */
  targetSampleRate: number;
  /** Target video frame rate; 0 = follow source. */
  targetFrameRate: number;
  /** Nominal ring capacity in seconds. */
  capacitySeconds: number;
  underrunPolicy: RingUnderrunPolicy;
  overrunPolicy: RingOverrunPolicy;
  /** static_once: rewind when drained. */
  loop: boolean;
  /** Audio output gain. */
  gain: number;
}

export interface LiveStreamHandle {
  streamId: string;
  origin: LiveStreamOrigin;
  mediaKind: LiveStreamMediaKind;
  nodeDefinitionId: string;
  label?: string;
  params: Record<string, unknown>;
  hasPcm?: boolean;
  hasVideo?: boolean;
  /** Present when produced by ring_buffer_source. */
  ring?: RingBufferConfig;
}

/**
 * Graph-local control bus event (Play/Stop, future conditional pulses).
 * Live session owns delivery; batch execute only snapshots the last event.
 */
export type ControlEventKind = 'start' | 'stop' | 'pulse' | 'arm' | 'disarm';

export interface ControlEvent {
  kind: ControlEventKind;
  atMs: number;
  sourceId: string;
  payload?: Record<string, unknown>;
}

/** Descriptor for a control source or gated consumer (native bus lives in Live session). */
export interface ControlHandle {
  controlId: string;
  nodeDefinitionId: string;
  label?: string;
  lastEvent?: ControlEvent;
  params?: Record<string, unknown>;
}

/** Frequency-domain snapshot from AnalyserNode, used by Live visualization. */
export interface AudioSpectrum {
  bins: Uint8Array;
  sampleRate: number;
  fftSize: number;
}

export interface EncodedTrack {
  trackId: string;
  kind: 'video' | 'audio';
  codec: string;
  codecFamily: CodecFamily;
  decoderConfig: DecoderConfig;
  packets: EncodedPacket[];
  metadata: Record<string, unknown>;
}

export interface MediaFile {
  fileName: string;
  mimeType: string;
  extension: string;
  data: Uint8Array;
  metadata: Record<string, unknown>;
}

export interface DecoderBackendInfo {
  id: string;
  version: string;
  api: 'webcodecs' | 'software' | 'wasm' | 'mock';
  codecFamilies: CodecFamily[];
  inputFormats: BitstreamFormat[];
  outputFormats: Array<DecodedVideoPixelFormat | 'f32-planar'>;
  hardwareAcceleration?: 'hardware' | 'software' | 'unknown';
}

/** Values that expose deterministic raw bytes for inspection tools. */
export type ByteData =
  | Uint8Array
  | BufferData
  | MediaSource
  | MediaAsset
  | MediaSelection
  | SelectedTrack
  | MediaSample[]
  | EncodedPacket[]
  | CompressedFrame
  | VideoFrameData
  | DecodedVideoFrame
  | DecodedVideoClip
  | PcmAudioClip
  | AudioBufferData
  | NalUnitData
  | SeiPayloadData
  | EncodedPacket
  | EncodedTrack
  | MediaFile;

// ─── media ───

export interface MediaAnalysisResult {
  format: MediaFormat;
  /** 轨道列表 */
  streams: StreamInfo[];
  /** 帧元数据列表（不含压缩像素数据） */
  frames: FrameInfo[];
  /** 格式特定附加信息 */
  formatSpecific: Record<string, unknown>;
  /** 文件总字节数（已知时） */
  fileSize?: number;
  /** 分析耗时 (ms) */
  duration?: number;
}

export interface MediaFormat {
  container: ContainerType;
  /** @example "flv", "mpegts", "mpegps", "mp4", "wav", "flac", "mp3", "opus" */
  subtype: string;
  /** 文件头部魔数等信息 */
  details: Record<string, unknown>;
}

export type ContainerType =
  | 'flv'
  | 'mpegts'
  | 'mpegps'
  | 'mp4'
  | 'raw_audio'
  | 'raw_video'
  | 'unknown';

// ─── stream ───

export interface StreamInfo {
  index: number;
  sourceId?: string | number;
  kind: 'video' | 'audio' | 'data';
  codec: string;
  codecFamily: CodecFamily;
  /** 编码器配置数据 (avcC / hvcC / AudioSpecificConfig) */
  codecConfig: Uint8Array | null;
  durationMs?: number;
  bitrate?: number;
  sampleCount?: number;
  language?: string;
  timeBase?: MediaTimeBase;
  metadata?: Record<string, unknown>;
  video?: VideoStreamDetail;
  audio?: AudioStreamDetail;
}

export interface VideoStreamDetail {
  width: number;
  height: number;
  profile?: string;
  level?: string;
  bitDepth?: number;
  chromaFormat?: number;
  framerate?: number;
}

export interface AudioStreamDetail {
  sampleRate: number;
  channels: number;
  profile?: string;
  samplesPerFrame?: number;
}

// ─── frames ───

export interface FrameInfo {
  index: number;
  streamIndex: number;
  kind: 'video' | 'audio';
  /** 解码时间戳 (毫秒) */
  dts: number;
  /** 显示时间戳 (毫秒) */
  pts: number;
  /** 样本时长 (毫秒) */
  duration?: number;
  /** 帧在容器中的起始偏移 — 语义因容器不同:
   *  FLV: tag 起点;  TS: PES offset;  MP4: sample start */
  offset: number;
  /** 帧数据的字节大小 */
  size: number;
  /** 是否为关键帧/同步点 */
  isKey: boolean;
  /** 是否为 IDR (瞬时解码刷新) */
  isIdr?: boolean;
  /** 帧类型: I, P, B, IDR */
  pictureType?: string;
  /** 编码顺序帧号 */
  frameNum?: number;
  /** 原始字节视图 (通常从 buffer 切片得来，可选) */
  rawData?: Uint8Array;
  dataOrigin?: 'source_slice' | 'demuxed_payload';
  metadata?: Record<string, unknown>;
}

// ─── compressed ───

export interface CompressedFrame {
  /** 编码器类型 */
  codec: string;
  codecFamily: 'h264' | 'h265' | 'aac' | 'g711' | 'unknown';
  /** 解码时间戳 */
  dts: number;
  /** 显示时间戳 */
  pts: number;
  /** 是否为关键帧 */
  isKey: boolean;
  /** 压缩帧数据 */
  data: Uint8Array;
  /** 编码器配置 (avcC / hvcC / ASC)，关键帧时携带 */
  codecConfig?: Uint8Array;
  /** 容器格式特有信息 */
  containerInfo?: {
    container: ContainerType;
    streamIndex: number;
    frameIndex: number;
  };
}

// ─── video_frame ───

export interface VideoFrameData {
  width: number;
  height: number;
  /**
   * 像素格式 — NV12、I420、RGBA8 等。
   * Display node 据此选择色彩空间转换路径。
   */
  format: VideoPixelFormat;
  /** 各平面原始像素数据 */
  planes: Uint8Array[];
  /** 各平面行步长 */
  strides: number[];
  /** 关联的来源 CompressedFrame 时间戳 */
  pts: number;
  /** 释放 planes 内存。调用后此对象不可再用。 */
  close(): void;
}

export type VideoPixelFormat = 'NV12' | 'I420' | 'I444' | 'RGBA8' | 'BGRA8';

// ─── audio_buffer ───

export interface AudioBufferData {
  sampleRate: number;
  channels: number;
  format: 'f32' | 's16' | 'u8';
  data: Float32Array | Int16Array | Uint8Array;
  /** 样本数（每通道） */
  sampleCount: number;
  pts: number;
  duration: number;
}

// ─── nal_units ───

export interface NalUnitData {
  codec: 'h264' | 'h265';
  units: NalUnit[];
}

export interface NalUnit {
  /** NAL unit type (0-31 for H.264, 0-63 for H.265) */
  type: number;
  /** 人类可读的类型名: "IDR_W_DLP", "SPS", "AUD" 等 */
  typeName: string;
  /** RBSP 数据（去除了防竞争字节） */
  data: Uint8Array;
  /** 在原始码流中的偏移 */
  offset: number;
  /** 包括 start code / length prefix 在内的总大小 */
  totalSize: number;
}

// ─── detections ───

export interface DetectionResult {
  boxes: DetectionBox[];
  timestamp: number;
  /** 检测耗时 (ms) */
  inferenceMs: number;
  /** 检测来源: 'onnx' | 'motion' | 'hybrid' */
  source: DetectionSource;
}

export interface DetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  classId: number;
  className: string;
  score: number;
  /** 跟踪 ID（多帧关联时） */
  trackId?: number;
}

export type DetectionSource = 'onnx' | 'motion' | 'hybrid';

// ─── sei_payload ───

export interface SeiPayloadData {
  /** SEI payload UUID (对于 user data unregistered) */
  uuid: string;
  /** SEI payload 原始数据 */
  data: Uint8Array;
  /** 来自的帧 PTS */
  pts: number;
}

# Media Workflow 通用数据 Port 规范

状态：Stable  
协议版本：1  
适用范围：Core、Codec、Node、UI、Worker 以及第三方节点插件

本文中的“必须”“禁止”“应该”是规范性要求。插件只有满足本文要求，才可以安全接入工作流 Runtime。

## 1. 设计目标

数据 Port 描述数据的业务语义，而不是 UI 颜色、类名或临时实现。

所有节点必须遵循以下原则：

- Port 类型必须来自 `@media-workflow/core` 的 `PinType`。
- 节点间只传递规范载体，不传递 DOM、LiteGraph 实例或插件私有类实例。
- 公共字段使用统一单位，格式原始值放入 `metadata`。
- 数据转换必须由显式节点完成，不进行隐式 `asset → track` 等转换。
- 大块二进制数据优先传递 `Uint8Array` 视图，禁止无必要复制。
- 无法解析的值保持 `undefined`，禁止用看似合理的默认值伪造结果。
- 解析异常通过 `MediaDiagnostic` 表达；不可恢复错误才抛出 `Error`。

## 2. 命名规则

### 2.1 Port 类型

Port 类型使用小写 `snake_case`，表示稳定的数据语义：

- `media_source`
- `media_probe`
- `media_asset`
- `track_list`
- `media_track`
- `media_samples`
- `byte_data`
- `compressed`
- `video_frame`
- `audio_buffer`
- `nal_units`
- `detections`
- `sei_payload`

禁止在 Port 类型中加入具体节点名，例如 `my_parser_output`。

### 2.2 Port 名称

输入输出名称应简短、稳定并与载体语义一致：

- `source: media_source`
- `asset: media_asset`
- `tracks: track_list`
- `track: media_track`
- `samples: media_samples`
- `bytes: byte_data`

修改已发布 Port 名称属于破坏性变更。

### 2.3 节点 ID

`NodeDefinition.id` 必须：

- 全局唯一；
- 使用小写 `snake_case`；
- 发布后保持稳定；
- 不包含版本号、显示文案或随机值。

实例 ID 由工作流图管理，与节点类型 ID 是不同概念。

## 3. Canonical Port

### 3.1 `media_source`

对应 `MediaSource`，表示一次分析的不可变输入：

```ts
interface MediaSource {
  sourceId: string;
  version: string;
  kind: 'file' | 'url' | 'memory' | 'stream';
  name: string;
  mimeType?: string;
  size: number;
  data: Uint8Array;
  metadata: Record<string, unknown>;
}
```

约束：

- `sourceId + version` 必须唯一标识输入内容版本，用于 Runtime 缓存。
- `size` 单位为字节，必须等于有效源数据大小。
- `data` 在执行期间视为只读。
- 文件修改、URL ETag 改变或流重连时必须更新 `version`。

### 3.2 `media_probe`

对应 `MediaProbe`，只表示格式探测结果，不表示完整解析结果。

- `confidence` 范围为 `0..1`。
- `format` 无法确认时使用 `unknown`。
- 候选格式及原因放入 `candidates`。
- 探测警告放入 `diagnostics`。

Probe 节点不得伪造 Track、Sample 或编码参数。

### 3.3 `media_asset`

对应 `MediaAsset`，是文件分析链路的核心聚合载体：

```ts
interface MediaAsset {
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
```

约束：

- `tracks` 中的 `trackId` 必须唯一。
- 每个 `samples[].trackId` 必须引用现有 Track。
- Container 私有 Box、Tag、PID 表等放入 `metadata`，禁止扩散为公共字段。
- 公共 UI 只能依赖规范字段；格式私有 UI 必须显式读取对应命名空间。

### 3.4 `track_list`

类型为 `MediaTrack[]`，表示来自同一 `MediaAsset` 的 Track 集合。

- 数组顺序应与容器稳定顺序一致。
- 禁止混合不同 Asset 的 Track。
- 列表是只读视图，节点不得原地排序或修改。

### 3.5 `media_track`

对应 `MediaTrack` 判别联合：

- `kind: video` 使用 `VideoMediaTrack`；
- `kind: audio` 使用 `AudioMediaTrack`；
- `kind: data` 使用 `DataMediaTrack`。

所有 Track 必须提供：

- `trackId`：工作流内稳定唯一 ID；
- `index`：规范化展示顺序；
- `codec`：人类可读编码名；
- `codecFamily`：稳定机器类型；
- `sampleCount`：该 Track 的规范 Sample 数；
- `metadata`：原始 Track ID、PID、handler 等。

视频字段：

- `width`、`height`：像素；
- `frameRate`：帧/秒；
- `bitDepth`：每分量位数；
- `profile`、`level`：字符串。

音频字段：

- `sampleRate`：Hz；
- `channels`：声道数；
- `samplesPerFrame`：每个编码帧的 PCM sample 数；
- `channelLayout`、`profile`：字符串。

### 3.6 `media_samples`

类型为 `MediaSample[]`，表示压缩帧、音频包或容器 Sample 的规范索引：

```ts
interface MediaSample {
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
  data?: Uint8Array;
  metadata: Record<string, unknown>;
}
```

约束：

- `index` 是 Asset 范围内的稳定顺序。
- `sampleId` 在 Asset 内唯一。
- `data` 是 demux 后 packet/sample payload 的只读视图。
- `data.byteLength` 应与 `size` 一致；无可用字节时允许为 `undefined`。
- `offset` 默认表示 payload 在 `MediaSource.data` 中的字节偏移。
- 重新封装、拼接或解码后的数据必须在 `metadata` 中说明 offset 语义。
- 关键帧必须设置 `isKey=true`；IDR 可同时使用 `pictureType='IDR'` 或 `metadata.isIdr=true`。

### 3.7 `byte_data`

`byte_data` 是只读检查工具使用的多态输入 Port，不是业务转换 Port。

当前可连接来源：

- `buffer`
- `media_source`
- `media_asset`
- `media_samples`
- `compressed`
- `video_frame`
- `audio_buffer`
- `nal_units`
- `sei_payload`

规则：

- `byte_data` 通常只用于 Hex View、哈希、签名检测、导出等工具节点。
- 业务节点不得使用 `byte_data` 代替明确类型。
- `MediaAsset` 读取 `source.data`。
- `media_samples` 按数组顺序拼接 `sample.data`。
- `video_frame` 按 planes 顺序拼接。
- `decoded_video_frames` 拼接目标帧 planes。
- `pcm_audio` 拼接 planar Float32 声道数据。
- `media_file` 读取 `data`。
- `nal_units` 按 units 顺序拼接。

## 4. Processing Port

### 4.1 `compressed`

表示单个编码帧，必须包含 codec、DTS、PTS、关键帧标记和 payload。

如果数据来自 `MediaSample`，时间戳必须转换为相同的微秒基准或明确记录转换。

### 4.2 `video_frame`

表示解码后视频帧：

- 宽高单位为像素；
- `planes` 顺序必须与 `format` 一致；
- `strides` 单位为字节/行；
- 持有外部资源时必须实现 `close()`；
- 生产节点必须使用 `ctx.resources.track()` 注册资源。

### 4.3 `audio_buffer`

表示解码后 PCM：

- `sampleRate`：Hz；
- `channels`：声道数；
- `sampleCount`：每声道 sample 数；
- `duration`：当前兼容结构使用秒；新扩展应优先增加 `durationUs`；
- `pts`：当前兼容结构由生产节点声明单位，后续主版本将统一为 `ptsUs`。

### 4.4 `nal_units`

NAL payload 不包含 Annex-B start code 或长度前缀时，必须在 metadata/节点文档中说明。

每个 NAL 必须提供类型、可读名称、原始偏移和总大小。

### 4.5 `detections`

坐标必须采用输入帧像素坐标。归一化坐标需要显式转换节点。

`score` 范围为 `0..1`，时间戳应与来源帧使用同一时间轴。

### 4.6 `sei_payload`

必须保留原始 payload 字节和来源帧时间戳。UUID 不适用时应使用稳定的消息类型标识。

### 4.7 `video_decode_request`

表示视频解码规划结果，包含完整 GOP 依赖包和目标 sample ID 列表。只描述「解哪些包」，不包含输出像素格式。

### 4.8 `audio_decode_request`

表示音频时间范围解码规划结果，范围采用半开区间 `[rangeStartUs, rangeEndUs)`。

### 4.9 `decoded_video_frames`

`DecodedVideoFrameSet` 载体，仅包含目标帧，GOP 预滚帧不进入结果。

### 4.10 `video_frame`

新版 `DecodedVideoFrame` 载体。旧 `VideoFrameData.close()` 语义仅保留在迁移层。

### 4.11 `pcm_audio`

统一 planar Float32 PCM 音频片段。

### 4.12 `encoded_track`

编码器输出轨道，供 Muxer 节点封装。

### 4.13 `media_file`

封装或导出后的最终文件字节。

## 5. 单位规范

### 5.1 时间

Canonical 字段统一使用整数微秒：

- `ptsUs`
- `dtsUs`
- `durationUs`

规则：

- 一秒等于 `1_000_000` 微秒。
- 禁止用字段名 `time`、`timestamp` 表达未声明单位。
- 原始容器 ticks 必须放入 metadata，并同时记录 `timeBase`。
- `MediaTimeBase.numerator / denominator` 表示每 tick 的秒数。
- UI 可转换为秒或毫秒展示，但不得修改载体值。
- `analysisDurationMs` 是性能耗时，明确使用毫秒，不属于媒体时间轴。

### 5.2 字节与码率

- `size`、`offset`、`byteLength`、`byteOffset`：字节。
- `bitrate`：bit/s，不是 byte/s 或 kb/s。
- UI 展示 kb/s 时除以 `1000`，不得改写原值。
- 二进制长度必须使用整数。

### 5.3 音视频

- `sampleRate`：Hz。
- `frameRate`：frame/s。
- `width`、`height`：像素。
- `strides`：字节/行。
- `bitDepth`、`bitsPerSample`：bit。
- `channels`：整数声道数。

## 6. ID 与引用完整性

### 6.1 Source

`sourceId` 表示来源，`version` 表示内容版本。缓存键必须同时使用两者。

### 6.2 Track

推荐构造：

```text
container:kind:containerTrackId
```

示例：

- `mpegts:video:257`
- `mp4:audio:2`
- `flv:video:video`

禁止只使用数组下标作为长期 Track ID。

### 6.3 Sample

推荐构造：

```text
trackId:sampleIndex
```

Sample 通过 `trackId` 引用 Track，禁止嵌入可变 Track 副本。

## 7. metadata 规范

`metadata` 只承载非通用字段。

要求：

- Key 使用稳定英文名称。
- 插件字段建议使用插件 ID 命名空间。
- 禁止把可由公共字段表达的数据重复放入 metadata。
- 禁止在 metadata 中保存 DOM、函数、循环引用或不可序列化对象。
- 大块原始数据应使用 `Uint8Array` 视图，不转为 number 数组或 Base64。

示例：

```ts
metadata: {
  "my_plugin.packetType": 7,
  "my_plugin.originalPtsTicks": 90000
}
```

## 8. Diagnostics

可恢复问题使用 `MediaDiagnostic`：

```ts
interface MediaDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
  metadata?: Record<string, unknown>;
}
```

要求：

- `code` 稳定、可机器判断，例如 `asset.non_monotonic_dts`。
- `message` 面向用户，包含具体上下文。
- `path` 指向规范载体路径。
- 同类大量问题应汇总数量，不生成数万个重复 diagnostic。
- 不支持的可选特性使用 warning；载体不满足不变量使用 error。
- 输入完全不可处理时抛出 `Error`，不得静默返回空对象。

## 9. Port 兼容规则

默认只允许相同类型连接：

```text
source.type === target.type
```

唯一通用协变输入是 `byte_data`。其兼容来源由 Core
`BYTE_PRODUCING_PIN_TYPES` 统一维护。

禁止插件：

- 在 UI 单独放宽连接但不更新 Core；
- 使用 `unknown`、`any` 或 `*` 绕过类型检查；
- 假设 `media_asset` 可以隐式连接 `media_track`；
- 在运行时临时猜测完全无关的输入结构。

新增兼容关系必须同时提供：

- Core `arePinTypesCompatible()` 规则；
- LiteGraph UI 连接规则；
- 正向和拒绝连接测试；
- 载体字节/语义转换实现。

## 10. NodeDefinition 开发规范

插件节点必须使用泛型声明输入输出：

```ts
import type {
  MediaAsset,
  MediaTrack,
  NodeDefinition,
} from '@media-workflow/core';

export const firstVideoTrackNode: NodeDefinition<
  { asset: 'media_asset' },
  { track: 'media_track' }
> = {
  id: 'first_video_track',
  category: 'utility',
  displayName: 'First Video Track',
  inputs: {
    asset: { type: 'media_asset', label: 'Media Asset' },
  },
  outputs: {
    track: { type: 'media_track', label: 'Video Track' },
  },
  async execute(ctx, { inputs }) {
    const asset = inputs.asset as MediaAsset | undefined;
    if (!asset) throw new Error('FirstVideoTrack: media asset is required');

    const track = asset.tracks.find(
      (candidate): candidate is MediaTrack =>
        candidate.kind === 'video',
    );
    if (!track) throw new Error('FirstVideoTrack: no video track');

    ctx.log.info(`Selected ${track.trackId}`);
    return { track };
  },
};
```

要求：

- `execute()` 不得访问 DOM 或 LiteGraph。
- 参数来自 `options.params`，不得读取 UI widget。
- 必须响应 `ctx.signal` 取消异步操作。
- 必须通过 `ctx.log` 输出运行信息。
- 必须通过 `ctx.resources` 跟踪需关闭的资源。
- 不修改输入对象；输出新对象或只读视图。
- 必需输入缺失时抛出明确错误。

## 11. Source、Transform、Display 职责

### Source

创建 `MediaSource`，负责来源身份和版本，不负责容器解析。

### Parser / Demux

输入 `media_source`，输出 `media_probe` 或 `media_asset`。

必须将格式私有结果规范化，不允许下游依赖 parser 私有对象。

### Utility / Analysis

输入规范载体并输出规范载体。筛选节点必须保持 `trackId`、`sampleId` 和时间单位。

### Display

Display 节点是数据 Sink：

- 业务计算仍在 `execute()` 中完成；
- DOM/Canvas 渲染由 UI renderer 处理；
- renderer 从 `NodeExecutionEvent.inputs/outputs` 读取数据；
- Display 节点不得把 DOM 节点作为输出。

## 12. Runtime 事件

Runtime 完成事件使用 `NodeExecutionEvent`，包含：

- node ID 和定义；
- resolved inputs；
- resolved params；
- outputs；
- durationMs；
- cacheHit；
- diagnostics；
- status/error。

UI、日志和监控必须订阅事件，不得侵入节点业务代码。

## 13. 缓存与确定性

节点输出应由以下内容唯一决定：

- 节点类型与实现版本；
- 输入 Port 数据；
- 参数；
- Source `sourceId + version`。

要求：

- 相同输入必须产生语义一致的输出。
- 不得使用当前时间、随机数或全局可变状态影响分析结果。
- `analyzedAt` 等观测字段不得参与业务判断。
- TypedArray 缓存指纹由 Runtime 统一计算。
- 文件改变后必须使来源及其下游缓存失效。

## 14. 二进制所有权与 Worker

- 主线程内 `Uint8Array.subarray()` 作为零拷贝只读视图。
- 跨 Worker 使用 Transferable 时，发送方必须视为已转移所有权。
- 同一 ArrayBuffer 不得在转移后继续读取。
- 需要共享时显式复制或使用符合环境安全要求的 SharedArrayBuffer。
- `VideoFrameData.close()` 等资源不得被多个节点重复关闭。

## 15. Legacy Port

以下类型保留用于迁移，不允许新插件使用：

- `buffer`
- `media`
- `stream`
- `frames`

迁移规则：

- `buffer` → `media_source` 或明确的 `byte_data`
- `media` → `media_asset`
- `stream` → `media_track`
- `frames` → `media_samples`

兼容层只允许存在于旧节点或 Codec adapter 边界。

## 16. 扩展新 Port 的流程

只有现有 Canonical Port 无法准确表达新语义时才能新增。

必须完成：

1. 在 `carriers.ts` 定义可序列化载体。
2. 在 `PinDataMap` 增加类型映射。
3. 明确所有字段单位、可选性和生命周期。
4. 更新 Core 和 LiteGraph 连接颜色/兼容规则。
5. 增加 producer、consumer 和拒绝连接测试。
6. 增加真实 fixture 或标准工具对照基线。
7. 更新本文协议版本和变更记录。

禁止仅为了颜色、显示文案或单一插件内部结构新增 Port。

## 17. 插件测试契约

每个插件节点至少提供：

- NodeDefinition 输入输出类型测试；
- 必需输入缺失测试；
- 参数边界测试；
- 正常数据输出测试；
- malformed 数据错误或 diagnostic 测试；
- 与不兼容 Port 的拒绝连接测试；
- 缓存确定性测试；
- 大数据不发生无意义复制的测试。

媒体解析、demux 或编码节点还必须提供：

- 真实媒体 fixture；
- FFprobe/FFmpeg 或同等级标准实现对照；
- Track 数量与类型；
- codec/profile/level；
- 时长、时基和码率；
- Sample 数量、PTS/DTS 和关键帧；
- packet payload size、SHA-256 或 HEX 前缀。

运行标准验证：

```sh
pnpm test:ffprobe
pnpm test:run
pnpm build
```

## 18. 插件接入检查清单

发布前逐项确认：

- 使用 Canonical Port，没有新增 Legacy Port 依赖。
- 所有时间字段有明确单位。
- 所有 size/offset 均为字节。
- bitrate 使用 bit/s。
- Track/Sample ID 稳定且引用有效。
- 未伪造未知编码参数。
- 输入数据未被原地修改。
- 大块字节使用视图或 Transferable。
- diagnostics code 稳定。
- execute 不依赖 DOM/LiteGraph。
- 参数可序列化并有默认值。
- Runtime 取消和资源回收有效。
- Core 与 UI 的连接规则一致。
- 单元测试、真实 fixture 和标准工具对照全部通过。

## 19. 规范源码

协议以以下源码为最终依据：

- `packages/core/src/types/carriers.ts`
- `packages/core/src/types/pins.ts`
- `packages/core/src/types/node.ts`
- `packages/core/src/graph/edge.ts`
- `packages/core/src/runtime/scheduler.ts`

文档与源码冲突时应立即修正文档或提升协议版本，禁止长期保持双重语义。


# Media Workflow Port Specification

Status: draft  
Protocol version: 2

This document defines the public data contracts shared by the runtime, built-in
nodes, UI, workers, and third-party plugins. Port types describe media meaning,
not a node implementation or UI widget.

## 1. Rules

- Port types come from `PinType` in `@media-workflow/core`.
- Values crossing a port use core carrier interfaces. DOM objects, LiteGraph
  objects, decoder instances, and plugin-private classes cannot cross ports.
- Time uses integer microseconds (`*Us`); byte locations use integer byte
  offsets and lengths.
- Carriers are immutable for the duration of a run.
- Unknown values remain `undefined`; nodes must not invent plausible defaults.
- Recoverable parser issues use `MediaDiagnostic`; execution-blocking failures
  throw an `Error`.
- IDs used by the cache are deterministic functions of their inputs.

## 2. Public workflow

The recommended pipeline is:

```text
media_source → media_asset → selected_track → media_selection
                                      ↘
media_asset | media_selection → decoded_video | pcm_audio
decoded_video → video_frame
```

Simple tasks may skip explicit `track_select` and `media_select` nodes:
`video_decode` and `audio_decode` accept an asset and materialize their own
selection. Professional workflows can expose either step for inspection and
reuse.

## 3. Canonical ports

### `media_source`

`MediaSource` is one immutable input revision. `sourceId + version` identifies
the revision for caching. `data` is a read-only `Uint8Array`.

### `media_asset`

`MediaAsset` is the normalized result of container analysis. It owns the source,
container metadata, tracks, samples, diagnostics, and analysis metadata.

### `selected_track`

`SelectedTrack` binds an asset, one track, and that track's samples in stable
source order:

```ts
interface SelectedTrack {
  selectedTrackId: string;
  asset: MediaAsset;
  track: MediaTrack;
  samples: MediaSample[];
  diagnostics: MediaDiagnostic[];
}
```

Use this contract when a downstream task must reuse or inspect a specific
track. Do not pass a bare `MediaTrack` where sample payload access is required.

### `media_selection`

`MediaSelection` is the single public contract for selected compressed media:

```ts
interface MediaSelection {
  selectionId: string;
  selectedTrack: SelectedTrack;
  criteria: MediaSelectionCriteria;
  samples: MediaSample[];
  rangeStartUs: number;
  rangeEndUs?: number;
  diagnostics: MediaDiagnostic[];
}
```

Selection ranges are half-open: `[startUs, endUs)`. Criteria can combine:

- source, presentation, or decode order;
- absolute or track-relative time;
- start/end sample index;
- video picture type (`I`, `P`, or `B`);
- result limit.

`selectionId` must be stable for the selected track revision, normalized
criteria, and resulting sample IDs. Selection never decodes samples.

### `decoded_video`

`DecodedVideoClip` contains the decoded frames for one selection:

```ts
interface DecodedVideoClip {
  requestId: string;
  selectionId?: string;
  backend: DecoderBackendInfo;
  frames: DecodedVideoFrame[];
  diagnostics: MediaDiagnostic[];
}
```

The clip is the default output of `video_decode`. A frame-level operation uses
`frame_extract` to produce `video_frame`.

### `pcm_audio`

`PcmAudioClip` contains decoded planar floating-point PCM and its sample rate,
channel count, duration, and optional originating selection.

### `video_frame`

`DecodedVideoFrame` is one frame with pixel format, dimensions, timestamps,
planes, and strides. Consumers must honor plane strides and format; they must
not assume tightly packed I420.

### `byte_data`

`byte_data` is a deliberate inspection/export union. It may receive a source,
asset, selected track, media selection, compressed packet data, encoded file,
or raw bytes. Adapters must preserve byte ranges and avoid copying unless the
consumer requires ownership.

## 4. Input union ports

Union ports are inputs only:

- `selection_source`: `media_asset | selected_track`
- `decode_source`: `media_asset | media_selection`

A union input does not authorize arbitrary implicit conversion. The receiving
node performs the documented selection operation and returns the resulting
`media_selection` so the decision remains observable.

## 5. Node library

Public built-in nodes are grouped by user intent:

- Source: `file_loader`, `url_fetcher`
- Analyze: `auto_analyze`
- Select: `track_select`, `media_select`
- Decode: `video_decode`, `audio_decode`
- Inspect: `stream_overview`, `track_detail`, `sample_table`, `hex_view`,
  `video_preview`
- Transform: `frame_extract`, `wav_encoder`
- Export: `raw_yuv_exporter`, `file_export`

Request-planner and backend-specific decoder nodes are implementation details,
not palette contracts. Workflows must not depend on their request carriers.

## 6. Compatibility

Connections require exact semantic types except for the documented input
unions and `byte_data` adapters. A matching TypeScript shape is not sufficient.
No implicit `asset → track`, `selection → frame`, or compressed → decoded
conversion is allowed.

Changes to a public port name, carrier meaning, unit, or ownership rule are
breaking protocol changes. Adding an optional field is compatible if existing
consumers can ignore it.

## 7. Runtime and cache

The runtime fingerprints sources by revision and selections by stable identity.
Parameter edits invalidate the edited node; downstream cache keys then change
naturally while unaffected upstream analysis remains reusable.

Ignored nodes and nodes missing required connections are excluded before
execution. A runnable node must have all required inputs connected and every
required upstream dependency must also be runnable.

## 8. Plugin checklist

A plugin is ready when it:

1. Uses only canonical public ports at workflow boundaries.
2. Declares every required input and validates values at runtime.
3. Preserves microsecond and byte units.
4. Produces deterministic IDs and output ordering.
5. Avoids unnecessary binary copies and does not mutate input carriers.
6. Emits actionable diagnostics or errors.
7. Tests valid execution, missing input, invalid parameters, cache stability,
   and relevant edge cases.

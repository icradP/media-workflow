# Workflow validation presets

Preset JSON files live in `packages/nodes/presets/`.

- `quick-overview.workflow.json` — minimal file → analyze → stream overview.
- `ffprobe-overview.workflow.json` validates container, all tracks, all samples,
  and raw source bytes.
- `ffprobe-video-track.workflow.json` selects the first video track and sends
  its first key frame to Frame Table and Hex View for byte-exact comparison.
- `ffprobe-audio-track.workflow.json` does the same for the first audio track.
- `decode-first-keyframe.workflow.json` plans a single-keyframe GOP decode request.
- `decode-audio-range.workflow.json` plans a 5-second AAC decode range.

The presets use stable node type IDs and named pins. They are instantiated by
`instantiateWorkflowPreset()` and executed against every real media fixture in
`workflow_presets.test.ts`. Expected results come from the FFprobe records in
`tests/fixtures/ffprobe/`.

The UI loads the same catalog via `WORKFLOW_PRESET_CATALOG` from
`@media-workflow/nodes`.

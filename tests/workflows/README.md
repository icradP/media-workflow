# Workflow validation presets

- `ffprobe-overview.workflow.json` validates container, all tracks, all samples,
  and raw source bytes.
- `ffprobe-video-track.workflow.json` selects the first video track and sends
  its first key frame to Frame Table and Hex View for byte-exact comparison.
- `ffprobe-audio-track.workflow.json` does the same for the first audio track.

The presets use stable node type IDs and named pins. They are instantiated by
`instantiateWorkflowPreset()` and executed against every real media fixture in
`workflow_presets.test.ts`. Expected results come from the FFprobe records in
`tests/fixtures/ffprobe/`.

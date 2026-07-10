# FFprobe reference baselines

These JSON files are generated from the media files in `tests/` and provide an
external reference for the in-repository parsers.

Regenerate all records:

```sh
pnpm fixtures:ffprobe
```

Regenerate selected records:

```sh
pnpm fixtures:ffprobe -- Duvet.mp3 test.ts
```

Each record contains:

- input size and SHA-256, so stale baselines fail tests;
- normalized expected format and stream fields used by assertions;
- complete FFprobe format, stream, program, and chapter metadata;
- FFmpeg full-decode warnings and exit status.

`packages/codec/src/__tests__/ffprobe_baseline.test.ts` compares the canonical
`MediaAsset` output against these records, including format detection, tracks,
codec details, duration, sample counts, and non-monotonic DTS diagnostics.

`tests/generated-av.mp4` is a deterministic two-second H.264/AAC fixture used
to exercise real MP4 `trak`, `stsd`, `stsc`, `stsz`, `stts`, `ctts`, and `stss`
tables. `tests/record.mp4` intentionally contains no `trak` boxes; FFprobe and
the project parser therefore both report zero tracks for that file.

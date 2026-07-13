# Media Workflow

Browser-based media analysis workflows built on typed data ports.

## Workflow model

The public node library follows one media-native path:

```text
Source → Analyze → Select → Decode → Inspect / Transform → Export
```

`media_select` produces the same `MediaSelection` contract consumed by decode,
inspection, and byte-view nodes. For short workflows, `video_decode` and
`audio_decode` also accept a `MediaAsset` directly and expose the selection they
materialized. See [the port specification](docs/PORT_SPEC.md) for the full
contract and node catalog.

## Development

```sh
pnpm install
pnpm dev
```

## Validation

```sh
pnpm test:run
pnpm test:ffprobe
pnpm test:decode
pnpm build
```

## Plugin protocol

All built-in and third-party nodes must follow the canonical data-port,
unit, ownership, diagnostics, and testing rules in
[docs/PORT_SPEC.md](docs/PORT_SPEC.md).

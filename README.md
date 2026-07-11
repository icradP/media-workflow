# Media Workflow

Browser-based media analysis workflows built on typed data ports.

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

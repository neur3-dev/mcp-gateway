# Contributing

## Development Setup

```bash
bun install
bun test
```

Use `config.example.yaml` as the starting point for local configuration and keep real secrets out of tracked files.

## Before Opening a Change

Run the smallest relevant verification gate for the change. For general work, use:

```bash
bun test
bun build src/server.ts --target=bun --outdir dist
```

`tsc --noEmit` is currently a known gap and should be reported accurately rather than treated as a passing gate until the SSE typings and dependency declarations are cleaned up.

## Pull Requests

- Keep changes scoped.
- Add or update tests for behavior changes.
- Document config or security-impacting changes.
- Do not commit credentials, tokens, private keys, customer data, or environment files.

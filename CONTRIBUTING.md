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
bun x tsc --noEmit
bun test
bun build src/server.ts --target=bun --outdir dist
```

All three must pass before opening a PR. The CI workflow enforces the same gates.

## Pull Requests

- Keep changes scoped.
- Add or update tests for behavior changes.
- Document config or security-impacting changes.
- Do not commit credentials, tokens, private keys, customer data, or environment files.

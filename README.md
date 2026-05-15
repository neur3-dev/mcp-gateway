# MCP Gateway

An alpha MCP multiplexing gateway for exposing multiple downstream MCP servers through one authenticated endpoint.

It currently supports:

- inbound MCP over streamable HTTP (`/mcp` endpoint, MCP 2025-03-26 spec)
- downstream MCP servers over stdio or SSE
- namespaced tool and resource aggregation
- API-key authentication with bcrypt-hashed keys
- per-tool RBAC with default deny
- per-caller and per-server rate limiting
- circuit breaking for unhealthy downstreams
- append-only PostgreSQL audit logging
- Docker packaging as a compiled Bun binary

## Status

This repository is an alpha implementation. The runtime path is buildable, the test suite passes, and `tsc --noEmit` is clean.

## Requirements

- Bun 1.x
- PostgreSQL 16+ for auth and audit storage
- downstream MCP servers reachable over stdio or SSE

## Quick Start

```bash
bun install
cp config.example.yaml config.yaml
export DATABASE_URL=postgres://gateway:gateway@localhost:5432/gateway
bun run src/server.ts
```

The gateway listens on `http://0.0.0.0:3000` by default.

To run the test suite:

```bash
bun test
```

To build the server bundle:

```bash
bun build src/server.ts --target=bun --outdir dist
```

## Configuration

Start from [`config.example.yaml`](./config.example.yaml). The sample config demonstrates:

- a local stdio server (`sqlite`)
- a remote SSE server (`github`)
- API-key header configuration
- rate limits
- circuit-breaker settings
- PostgreSQL-backed audit logging

Secrets should be supplied through environment variables or encrypted `enc:` values. Do not commit real credentials in `config.yaml`.

## Security Notes

- RBAC defaults to deny when no matching policy exists.
- Audit rows are append-only at the database layer.
- Raw API keys are never stored, only bcrypt hashes.
- The sample Docker Compose file uses local development credentials and is not a production deployment guide.
- Production deployments should terminate TLS, use real database credentials, review downstream server trust, and keep `/debug/*` disabled.

## Repository Layout

- `src/` - gateway implementation
- `tests/` - Bun test suite
- `migrations/` - PostgreSQL schema
- `docker/` - container build and local compose setup
- `config.example.yaml` - starter configuration

## Known Gaps

- There is no stable admin CLI for API-key or RBAC management yet (planned).
- This alpha does not yet ship a full operator guide or release process.

## Development

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for contribution guidance and [`SECURITY.md`](./SECURITY.md) for vulnerability reporting expectations.

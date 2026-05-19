# Changelog

## [Unreleased]

---

## [0.1.0-beta] — beta release

### Changed
- Removed unused `scopes` field from `CallerContext` — access control is RBAC-based, not per-key scopes
- `getDownstreamHealth()` now caches probe results for 10 seconds to avoid hammering downstream servers during frequent Kubernetes readiness checks
- `mgw` admin CLI binary now compiled and embedded in the Docker runtime image
- Documented three CLI access patterns: source, `docker compose exec`, and one-off `docker run`

---

## [0.1.0-alpha] — initial public release

### Added
- Streamable HTTP MCP gateway (MCP 2025-03-26 spec)
- Downstream MCP over stdio and SSE
- Namespaced tool and resource aggregation
- API key authentication with bcrypt hashing and 16-character prefix index (O(1) lookup)
- Per-caller and per-server token bucket rate limiting with optional Redis backing
- Circuit breaker with configurable fail-closed behavior (Redis-backed, in-memory fallback)
- Append-only PostgreSQL audit log with argument redaction
- Per-tool RBAC with default deny
- Session TTL with graceful cleanup
- Graceful shutdown (SIGTERM/SIGINT drain order: sessions → pool → Redis → DB)
- Configurable CORS origins
- `/health` liveness and `/ready` readiness endpoints
- `/ready` probes each downstream with a real `listTools()` call (3s timeout, 10s result cache)
- Configurable readiness: `readiness.require_redis` and `readiness.require_downstreams`
- OAuth2 client_credentials support for SSE downstreams with proactive token refresh and refresh mutex
- Isolated stdio environment (only `PATH` + explicit `server.env` passed to child processes)
- Docker Compose packaging with Redis and PostgreSQL
- Admin CLI for key management, RBAC policies, and audit log queries
- `DEPLOYMENT.md` production runbook
- GitHub Actions CI (typecheck + migrations + tests + build)
- Idempotent SQL migrations (0001–0003 run on first boot; 0004 is optional hardening)

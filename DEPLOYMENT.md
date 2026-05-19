# Deployment Guide

## Prerequisites

- Docker 24+ and Docker Compose v2
- A reverse proxy (nginx, Caddy, or Traefik) that terminates TLS — the gateway has no built-in TLS
- PostgreSQL 16 (provided by Docker Compose or an external instance)
- Redis 7 (provided by Docker Compose or an external instance)

## Quick Start (Docker Compose)

```bash
cp docker/config.yaml.example docker/config.yaml   # edit as needed
docker compose -f docker/docker-compose.yml up -d
```

The gateway listens on port 3000 by default. All three migrations run automatically on first boot.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/db` |
| `REDIS_URL` | No | Redis connection string, e.g. `redis://host:6379`. Omit to use in-memory rate limiting |
| `CONFIG_PATH` | No | Path to `config.yaml` inside the container. Default: `./config.yaml` |
| `NODE_ENV` | No | Set to `production` to suppress the `/debug/config` route and enable production error responses |
| `SESSION_TTL_MS` | No | SSE session idle timeout in milliseconds. Default: `14400000` (4 hours) |

## config.yaml Reference

Copy `config.example.yaml` and edit before deploying.

### Key settings for production

```yaml
gateway:
  host: "0.0.0.0"        # bind address inside the container
  port: 3000
  cors_origins:           # restrict to your frontend origin(s); omit to allow all
    - "https://app.example.com"

auth:
  bcrypt_rounds: 12       # minimum 10; increase to 14 for high-security deployments

circuit_breaker:
  failure_threshold: 5
  reset_timeout_ms: 30000
  fail_closed: true       # recommended for production — deny requests when Redis is unreadable

redis:
  url: "${REDIS_URL}"
  fail_closed: true       # recommended for production

audit:
  enabled: true
  redact_args: true       # always true in production

# readiness: controls which checks must pass for /ready to return HTTP 200.
# DB is always required; Redis and downstreams are optional (default: false).
readiness:
  require_redis: true
  require_downstreams: false
```

## Migrations

Migrations are plain SQL files in `migrations/` and are idempotent. They run automatically via the Docker Compose `db` init directory. To run them manually:

```bash
psql "$DATABASE_URL" -f migrations/0001_initial.sql
psql "$DATABASE_URL" -f migrations/0002_key_prefix.sql
psql "$DATABASE_URL" -f migrations/0003_args_record.sql
```

### Optional: Drop Legacy API Key Prefix Fallback

After all API keys have been rotated (every active key has a non-null `key_prefix`), apply migration `0004` to enforce the column as NOT NULL and remove the O(n) scan fallback:

```bash
# Verify no null-prefix keys remain first
psql "$DATABASE_URL" -c "SELECT id, name FROM api_keys WHERE key_prefix IS NULL AND revoked = FALSE;"
# If empty, apply:
psql "$DATABASE_URL" -f migrations/0004_key_prefix_required.sql
```

Then remove the `isNull(apiKeys.key_prefix)` branch in `src/auth/api-keys.ts`.

## nginx Reverse Proxy

The gateway does not terminate TLS. Put nginx (or Caddy) in front:

```nginx
server {
    listen 443 ssl http2;
    server_name gateway.example.com;

    ssl_certificate     /etc/ssl/certs/gateway.crt;
    ssl_certificate_key /etc/ssl/private/gateway.key;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Required for SSE
        proxy_set_header   Connection "";
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

## Admin CLI

Manage API keys, RBAC policies, and audit logs via the CLI:

```bash
# Create an API key scoped to specific servers
bun run mgw keys create --caller "ci-agent" --scopes "sqlite/*,github/list_repos"

# List all active keys
bun run mgw keys list

# Revoke a key by ID
bun run mgw keys revoke <key-id>

# Add an RBAC policy
bun run mgw policy add --caller "ci-agent" --pattern "sqlite/*"

# View recent audit entries
bun run mgw audit list --caller "ci-agent" --limit 50
```

## Health Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness probe — returns `{ status: "ok" }` immediately |
| `GET /ready` | Readiness probe — checks DB, Redis, and circuit breaker state for each downstream server |

The `/ready` response looks like:

```json
{
  "db": "ok",
  "redis": "ok",
  "server:sqlite": "ok",
  "server:github": "circuit_open",
  "status": "ready"
}
```

Returns `503` if the database is unavailable.

## Production Checklist

- [ ] `NODE_ENV=production` set
- [ ] `bcrypt_rounds` ≥ 12
- [ ] `audit.redact_args: true`
- [ ] `cors_origins` restricted to your frontend domain(s)
- [ ] `circuit_breaker.fail_closed: true`
- [ ] `redis.fail_closed: true`
- [ ] TLS terminated at reverse proxy; gateway not exposed directly on port 443
- [ ] PostgreSQL credentials rotated from Docker Compose defaults
- [ ] Firewall rule: port 3000 accessible only from the reverse proxy, not the public internet
- [ ] API keys created with minimum required scopes (principle of least privilege)
- [ ] Audit log retention policy configured at the database level

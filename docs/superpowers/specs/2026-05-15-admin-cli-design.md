# Admin CLI Design — MCP Gateway

**Date:** 2026-05-15
**Status:** Approved

---

## Overview

A standalone Bun CLI (`mgw`) that gives operators full lifecycle control over API keys, RBAC policies, and audit log visibility. Lives in the same repo as the gateway, connects directly to PostgreSQL via `DATABASE_URL`, and reuses existing auth functions from `src/auth/`.

---

## Architecture

### Location

```
src/cli/
├── index.ts          # Entry: parses argv, dispatches to command handlers
├── commands/
│   ├── keys.ts       # create, list, revoke
│   ├── policy.ts     # add, list, remove
│   └── audit.ts      # list
└── display.ts        # table renderer, error/success formatting
```

### Build

- Dev: `bun src/cli/index.ts <args>` (add script `"mgw": "bun src/cli/index.ts"` to package.json)
- Production: `bun build --compile --minify src/cli/index.ts --outfile=mgw` (alongside `gateway` binary)

### Connection

Reads `DATABASE_URL` from environment. Exits with `Error: DATABASE_URL is not set` (code 1) if missing. Calls `getDb()` from existing `src/db/client.ts` — no new connection logic.

### Dispatch

Framework-free: `process.argv` sliced at index 2, matched against a command table (`keys create`, `keys list`, etc.). Unknown commands print usage and exit 1. All errors go to stderr; exit code 1 on any failure, 0 on success.

---

## Commands

### Key Management

**`mgw keys create --name <name> --caller <caller-id> [--rounds <bcrypt-rounds>]`**

Creates a new API key. Calls existing `createApiKey(db, {name, callerId, bcryptRounds})`.

Output (stdout):
```
Created API key
  Name:      ci-agent
  Caller ID: ci
  Key ID:    xK9mNpQrLwTy
  Raw key:   mgk_<40-char>

Store this key securely — it cannot be retrieved again.
```

`--rounds` defaults to 12. Accept lower values for test environments.

---

**`mgw keys list`**

Lists all keys (revoked and active). Calls new `listKeys(db)` query.

Output:
```
ID              NAME        CALLER   REVOKED  LAST USED
xK9mNpQrLwTy   ci-agent    ci       no       2026-05-15 01:32 UTC
bR3tYuIoWxZa   dev-agent   dev      yes      2026-05-14 18:00 UTC
```

Columns: `id`, `name`, `caller_id`, `revoked`, `last_used_at` (formatted, "never" if null).

---

**`mgw keys revoke <key-id>`**

Revokes a key by ID. Calls existing `revokeApiKey(db, keyId)`.

Output:
```
Revoked key xK9mNpQrLwTy
```

Exits 1 with error if key ID not found.

---

### Policy Management

**`mgw policy add --caller <caller-id> --pattern <tool-pattern> --effect <allow|deny>`**

Adds an RBAC policy. Calls existing `createPolicy(db, {callerId, toolPattern, effect})`.

Pattern examples: `sqlite/*`, `github/create_issue`, `*` (all tools).

Output:
```
Added policy pJ7kLmNoPqRs
  Caller:  ci
  Pattern: github/*
  Effect:  allow
```

---

**`mgw policy list [--caller <caller-id>]`**

Lists policies, optionally filtered by caller. Calls new `listPolicies(db, callerId?)` query.

Output:
```
ID              CALLER   PATTERN      EFFECT
pJ7kLmNoPqRs   ci       github/*     allow
qK8lMnOpQrSt   ci       sqlite/*     allow
rL9mNoOpRsTu   dev      *            deny
```

---

**`mgw policy remove <policy-id>`**

Deletes a policy by ID. New `removePolicy(db, id)` query (DELETE from `rbac_policies`).

Output:
```
Removed policy pJ7kLmNoPqRs
```

Exits 1 with error if ID not found.

---

### Audit Log

**`mgw audit list [--caller <caller-id>] [--limit <n>]`**

Shows recent audit events. Default limit: 50. Calls new `listAuditEvents(db, {callerId?, limit})` query (SELECT … ORDER BY recorded_at DESC LIMIT n).

Output:
```
TIME (UTC)            CALLER   TOOL                    STATUS       LATENCY
2026-05-15 01:32:00   ci       github/create_issue     ok           142ms
2026-05-15 01:31:58   ci       sqlite/write_query      denied       —
2026-05-15 01:31:55   dev      github/list_repos       rate_limited —
```

Latency shown as `—` when null (denied/rate_limited events).

---

## New DB Queries (src/auth/)

Three read queries added to existing auth modules:

| Function | File | Query |
|---|---|---|
| `listKeys(db)` | `src/auth/api-keys.ts` | `SELECT * FROM api_keys ORDER BY created_at DESC` |
| `listPolicies(db, callerId?)` | `src/auth/rbac.ts` | `SELECT * FROM rbac_policies [WHERE caller_id = $1] ORDER BY created_at DESC` |
| `removePolicy(db, id)` | `src/auth/rbac.ts` | `DELETE FROM rbac_policies WHERE id = $1` |
| `listAuditEvents(db, opts)` | new `src/auth/audit.ts` | `SELECT * FROM audit_log [WHERE caller_id = $1] ORDER BY recorded_at DESC LIMIT $2` |

---

## Display Module (`src/cli/display.ts`)

Single responsibility: format and print. Two exports:

- `printTable(headers: string[], rows: string[][]): void` — fixed-width columns, no external deps
- `printError(msg: string): void` — writes `Error: <msg>` to stderr

No color/ANSI codes — keeps output clean in log files and CI.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `DATABASE_URL` not set | stderr: `Error: DATABASE_URL is not set` · exit 1 |
| DB connection fails | stderr: `Error: Cannot connect to database: <pg error>` · exit 1 |
| Unknown command | stderr: usage string · exit 1 |
| Missing required flag | stderr: `Error: --name is required` · exit 1 |
| Key/policy ID not found | stderr: `Error: Key <id> not found` · exit 1 |
| Invalid `--effect` value | stderr: `Error: --effect must be "allow" or "deny"` · exit 1 |

Stack traces never printed to end users.

---

## Testing

New unit tests added to `tests/auth.test.ts`:
- `listKeys` — returns all keys ordered by created_at
- `listPolicies` — returns all policies; filters by callerId when provided
- `removePolicy` — deletes by ID; returns not-found indicator for unknown ID
- `listAuditEvents` — returns events ordered by recorded_at DESC, respects limit

CLI dispatcher (`src/cli/index.ts`) and display module are not unit-tested — covered by the underlying function tests and a manual smoke test checklist.

**Manual smoke test:**
```bash
export DATABASE_URL=postgresql://gateway:gateway@localhost:5432/mcp_gateway_test
bun src/cli/index.ts keys create --name smoke --caller test
bun src/cli/index.ts keys list
bun src/cli/index.ts policy add --caller test --pattern "sqlite/*" --effect allow
bun src/cli/index.ts policy list --caller test
bun src/cli/index.ts audit list --limit 5
```

---

## Out of Scope

- JSON output flag (`--json`) — not needed for now
- Interactive/TUI mode
- Key rotation
- Bulk import/export
- Web UI

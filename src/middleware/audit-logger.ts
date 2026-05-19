import { createHash } from "crypto";
import { nanoid } from "nanoid";
import { auditLog } from "../db/schema";
import type { getDb } from "../db/client";

type Db = ReturnType<typeof getDb>;

export interface AuditConfig {
  enabled: boolean;
  redact_args: boolean;
}

export interface AuditEvent {
  callerId: string;
  keyId: string;
  tool: string;
  server: string;
  method: string;
  args?: unknown;
  latencyMs?: number;
  status: "ok" | "error" | "denied" | "rate_limited";
  errorMessage?: string;
}

function hashArgs(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(args ?? {})).digest("hex");
}

const MAX_RAW_ARGS_LEN = 4096;

function serializeArgs(args: unknown, redact: boolean): string | null {
  if (args === undefined) return null;
  if (redact) return hashArgs(args);
  const raw = JSON.stringify(args);
  return raw.length > MAX_RAW_ARGS_LEN ? raw.slice(0, MAX_RAW_ARGS_LEN) + "…" : raw;
}

export async function writeAuditEvent(
  db: Db,
  event: AuditEvent,
  auditConfig: AuditConfig = { enabled: true, redact_args: true }
): Promise<void> {
  if (!auditConfig.enabled) return;

  await db.insert(auditLog).values({
    id: nanoid(16),
    caller_id: event.callerId,
    key_id: event.keyId,
    tool: event.tool,
    server: event.server,
    method: event.method,
    args_hash: serializeArgs(event.args, auditConfig.redact_args),
    latency_ms: event.latencyMs ?? null,
    status: event.status,
    error_message: event.errorMessage ?? null,
  });
}

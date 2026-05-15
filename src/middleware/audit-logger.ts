import { createHash } from "crypto";
import { nanoid } from "nanoid";
import { auditLog } from "../db/schema";
import type { getDb } from "../db/client";

type Db = ReturnType<typeof getDb>;

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

export async function writeAuditEvent(db: Db, event: AuditEvent): Promise<void> {
  await db.insert(auditLog).values({
    id: nanoid(16),
    caller_id: event.callerId,
    key_id: event.keyId,
    tool: event.tool,
    server: event.server,
    method: event.method,
    args_hash: event.args !== undefined ? hashArgs(event.args) : null,
    latency_ms: event.latencyMs ?? null,
    status: event.status,
    error_message: event.errorMessage ?? null,
  });
}

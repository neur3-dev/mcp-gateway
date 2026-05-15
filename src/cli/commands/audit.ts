import { getDb } from "../../db/client";
import { listAuditEvents } from "../../auth/audit";
import { printTable, printError } from "../display";

function parseFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

function requireDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    printError("DATABASE_URL is not set");
    process.exit(1);
  }
  return getDb(url);
}

export async function auditList(args: string[]): Promise<void> {
  const db = requireDb();
  const callerId = parseFlag(args, "--caller");
  const limitStr = parseFlag(args, "--limit");
  const limit = limitStr ? parseInt(limitStr, 10) : 50;

  const rows = await listAuditEvents(db, { callerId, limit });
  printTable(
    ["TIME (UTC)", "CALLER", "TOOL", "STATUS", "LATENCY"],
    rows.map((r) => [
      r.recorded_at
        ? r.recorded_at.toISOString().slice(0, 19).replace("T", " ")
        : "—",
      r.caller_id,
      r.tool,
      r.status,
      r.latency_ms != null ? `${r.latency_ms}ms` : "—",
    ])
  );
}

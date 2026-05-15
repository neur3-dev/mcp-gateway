import { desc, eq } from "drizzle-orm";
import { auditLog } from "../db/schema";
import type { getDb } from "../db/client";

type Db = ReturnType<typeof getDb>;

export async function listAuditEvents(
  db: Db,
  opts: { callerId?: string; limit?: number }
) {
  const limit = opts.limit ?? 50;
  if (opts.callerId) {
    return db
      .select()
      .from(auditLog)
      .where(eq(auditLog.caller_id, opts.callerId))
      .orderBy(desc(auditLog.recorded_at))
      .limit(limit);
  }
  return db.select().from(auditLog).orderBy(desc(auditLog.recorded_at)).limit(limit);
}

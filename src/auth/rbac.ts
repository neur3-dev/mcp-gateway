import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { rbacPolicies } from "../db/schema";
import type { getDb } from "../db/client";

type Db = ReturnType<typeof getDb>;

export async function createPolicy(
  db: Db,
  opts: { callerId: string; toolPattern: string; effect: "allow" | "deny" }
): Promise<{ id: string }> {
  const id = nanoid(16);
  await db.insert(rbacPolicies).values({
    id,
    caller_id: opts.callerId,
    tool_pattern: opts.toolPattern,
    effect: opts.effect,
  });
  return { id };
}

function matchesPattern(pattern: string, tool: string): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return tool.startsWith(prefix + "/");
  }
  return pattern === tool;
}

export async function checkRbac(
  db: Db,
  callerId: string,
  tool: string
): Promise<"allow" | "deny"> {
  const policies = await db
    .select()
    .from(rbacPolicies)
    .where(eq(rbacPolicies.caller_id, callerId));

  const matching = policies.filter((p) => matchesPattern(p.tool_pattern, tool));

  if (matching.some((p) => p.effect === "deny")) return "deny";
  if (matching.some((p) => p.effect === "allow")) return "allow";

  return "deny";
}

export async function listPolicies(db: Db, callerId?: string) {
  if (callerId) {
    return db
      .select()
      .from(rbacPolicies)
      .where(eq(rbacPolicies.caller_id, callerId))
      .orderBy(desc(rbacPolicies.created_at));
  }
  return db.select().from(rbacPolicies).orderBy(desc(rbacPolicies.created_at));
}

export async function removePolicy(db: Db, id: string): Promise<boolean> {
  const deleted = await db
    .delete(rbacPolicies)
    .where(eq(rbacPolicies.id, id))
    .returning({ id: rbacPolicies.id });
  return deleted.length > 0;
}

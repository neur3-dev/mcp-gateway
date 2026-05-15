import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { rbacPolicies } from "../db/schema";
import type { getDb } from "../db/client";

type Db = ReturnType<typeof getDb>;

export async function createPolicy(
  db: Db,
  opts: { callerId: string; toolPattern: string; effect: "allow" | "deny" }
): Promise<void> {
  await db.insert(rbacPolicies).values({ id: nanoid(16), caller_id: opts.callerId, tool_pattern: opts.toolPattern, effect: opts.effect });
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

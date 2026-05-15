import { getDb } from "../../db/client";
import { createPolicy, listPolicies, removePolicy } from "../../auth/rbac";
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

export async function policyAdd(args: string[]): Promise<void> {
  const db = requireDb();
  const callerId = parseFlag(args, "--caller");
  const pattern = parseFlag(args, "--pattern");
  const effect = parseFlag(args, "--effect");

  if (!callerId) { printError("--caller is required"); process.exit(1); }
  if (!pattern) { printError("--pattern is required"); process.exit(1); }
  if (!effect) { printError("--effect is required"); process.exit(1); }
  if (effect !== "allow" && effect !== "deny") {
    printError('--effect must be "allow" or "deny"');
    process.exit(1);
  }

  const { id } = await createPolicy(db, { callerId, toolPattern: pattern, effect });

  console.log(`Added policy ${id}`);
  console.log(`  Caller:  ${callerId}`);
  console.log(`  Pattern: ${pattern}`);
  console.log(`  Effect:  ${effect}`);
}

export async function policyList(args: string[]): Promise<void> {
  const db = requireDb();
  const callerId = parseFlag(args, "--caller");
  const rows = await listPolicies(db, callerId);
  printTable(
    ["ID", "CALLER", "PATTERN", "EFFECT"],
    rows.map((r) => [r.id, r.caller_id, r.tool_pattern, r.effect])
  );
}

export async function policyRemove(args: string[]): Promise<void> {
  const db = requireDb();
  const policyId = args[0];
  if (!policyId) { printError("policy ID is required"); process.exit(1); }

  const found = await removePolicy(db, policyId);
  if (!found) {
    printError(`Policy ${policyId} not found`);
    process.exit(1);
  }

  console.log(`Removed policy ${policyId}`);
}

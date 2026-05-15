import { getDb } from "../../db/client";
import { createApiKey, listKeys, revokeApiKey } from "../../auth/api-keys";
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

export async function keysCreate(args: string[]): Promise<void> {
  const db = requireDb();
  const name = parseFlag(args, "--name");
  const callerId = parseFlag(args, "--caller");
  const roundsStr = parseFlag(args, "--rounds");

  if (!name) { printError("--name is required"); process.exit(1); }
  if (!callerId) { printError("--caller is required"); process.exit(1); }

  const bcryptRounds = roundsStr ? parseInt(roundsStr, 10) : 12;
  if (roundsStr && (isNaN(bcryptRounds) || bcryptRounds < 1)) {
    printError("--rounds must be a positive integer");
    process.exit(1);
  }
  const { keyId, rawKey } = await createApiKey(db, { name, callerId, bcryptRounds });

  console.log("Created API key");
  console.log(`  Name:      ${name}`);
  console.log(`  Caller ID: ${callerId}`);
  console.log(`  Key ID:    ${keyId}`);
  console.log(`  Raw key:   ${rawKey}`);
  console.log("");
  console.log("Store this key securely — it cannot be retrieved again.");
}

export async function keysList(): Promise<void> {
  const db = requireDb();
  const rows = await listKeys(db);
  printTable(
    ["ID", "NAME", "CALLER", "REVOKED", "LAST USED"],
    rows.map((r) => [
      r.id,
      r.name,
      r.caller_id,
      r.revoked ? "yes" : "no",
      r.last_used_at
        ? r.last_used_at.toISOString().slice(0, 16).replace("T", " ") + " UTC"
        : "never",
    ])
  );
}

export async function keysRevoke(args: string[]): Promise<void> {
  const db = requireDb();
  const keyId = args[0];
  if (!keyId) { printError("key ID is required"); process.exit(1); }

  const all = await listKeys(db);
  if (!all.some((k) => k.id === keyId)) {
    printError(`Key ${keyId} not found`);
    process.exit(1);
  }

  await revokeApiKey(db, keyId);
  console.log(`Revoked key ${keyId}`);
}

import { hash, compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { apiKeys } from "../db/schema";
import type { CallerContext } from "../types";
import type { getDb } from "../db/client";

type Db = ReturnType<typeof getDb>;

const PREFIX = "mgk_";

export async function createApiKey(
  db: Db,
  opts: { name: string; callerId: string; bcryptRounds?: number }
): Promise<{ keyId: string; rawKey: string }> {
  const rawKey = PREFIX + nanoid(40);
  const keyId = nanoid(16);
  const key_hash = await hash(rawKey, opts.bcryptRounds ?? 12);

  await db.insert(apiKeys).values({
    id: keyId,
    name: opts.name,
    key_hash,
    caller_id: opts.callerId,
  });

  return { keyId, rawKey };
}

export async function verifyApiKey(
  db: Db,
  rawKey: string
): Promise<(CallerContext & { keyId: string }) | null> {
  if (!rawKey.startsWith(PREFIX)) return null;

  const rows = await db.select().from(apiKeys).where(eq(apiKeys.revoked, false));

  for (const row of rows) {
    const match = await compare(rawKey, row.key_hash);
    if (match) {
      db.update(apiKeys)
        .set({ last_used_at: new Date() })
        .where(eq(apiKeys.id, row.id))
        .execute()
        .catch(() => {});

      return { callerId: row.caller_id, keyId: row.id, scopes: [] };
    }
  }
  return null;
}

export async function revokeApiKey(db: Db, keyId: string): Promise<void> {
  await db.update(apiKeys).set({ revoked: true }).where(eq(apiKeys.id, keyId));
}

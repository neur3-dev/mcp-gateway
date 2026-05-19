import { hash, compare } from "bcryptjs";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { apiKeys } from "../db/schema";
import type { CallerContext } from "../types";
import type { getDb } from "../db/client";

type Db = ReturnType<typeof getDb>;

const PREFIX = "mgk_";
const PREFIX_LEN = 16; // chars stored after the "mgk_" scheme prefix

function extractPrefix(rawKey: string): string {
  return rawKey.slice(PREFIX.length, PREFIX.length + PREFIX_LEN);
}

export async function createApiKey(
  db: Db,
  opts: { name: string; callerId: string; bcryptRounds?: number }
): Promise<{ keyId: string; rawKey: string }> {
  const rawKey = PREFIX + nanoid(40);
  const keyId = nanoid(16);
  const key_hash = await hash(rawKey, opts.bcryptRounds ?? 12);
  const key_prefix = extractPrefix(rawKey);

  await db.insert(apiKeys).values({
    id: keyId,
    name: opts.name,
    key_hash,
    key_prefix,
    caller_id: opts.callerId,
  });

  return { keyId, rawKey };
}

export async function verifyApiKey(
  db: Db,
  rawKey: string
): Promise<(CallerContext & { keyId: string }) | null> {
  if (!rawKey.startsWith(PREFIX)) return null;

  const prefix = extractPrefix(rawKey);

  // Fetch only rows whose prefix matches (O(1) index scan) OR legacy rows with no prefix yet.
  // Once all keys are rotated the isNull branch will return nothing.
  const rows = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.revoked, false),
        or(eq(apiKeys.key_prefix, prefix), isNull(apiKeys.key_prefix))
      )
    );

  for (const row of rows) {
    const match = await compare(rawKey, row.key_hash);
    if (match) {
      // Backfill prefix for legacy rows on first successful auth
      if (!row.key_prefix) {
        db.update(apiKeys)
          .set({ key_prefix: prefix, last_used_at: new Date() })
          .where(eq(apiKeys.id, row.id))
          .execute()
          .catch(() => {});
      } else {
        db.update(apiKeys)
          .set({ last_used_at: new Date() })
          .where(eq(apiKeys.id, row.id))
          .execute()
          .catch(() => {});
      }

      return { callerId: row.caller_id, keyId: row.id, scopes: [] };
    }
  }
  return null;
}

export async function revokeApiKey(db: Db, keyId: string): Promise<void> {
  await db.update(apiKeys).set({ revoked: true }).where(eq(apiKeys.id, keyId));
}

export async function listKeys(db: Db) {
  return db.select().from(apiKeys).orderBy(desc(apiKeys.created_at));
}

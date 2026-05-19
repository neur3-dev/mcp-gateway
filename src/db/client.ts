import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: postgres.Sql | null = null;

export function getDb(postgresUrl?: string) {
  if (_db) return _db;
  const url = postgresUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  _client = postgres(url, { max: 10 });
  _db = drizzle(_client, { schema });
  return _db;
}

export async function endDb(): Promise<void> {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = null;
    _db = null;
  }
}

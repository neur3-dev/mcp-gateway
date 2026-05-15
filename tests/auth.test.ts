import { describe, it, expect, beforeAll } from "bun:test";
import { createApiKey, verifyApiKey, revokeApiKey } from "../src/auth/api-keys";
import { getDb } from "../src/db/client";
import { apiKeys } from "../src/db/schema";

describe("API Key auth", () => {
  const db = getDb("postgresql://gateway:gateway@localhost:5432/mcp_gateway_test");

  beforeAll(async () => {
    await db.delete(apiKeys);
  });

  it("creates a key and verifies the raw value", async () => {
    const { keyId, rawKey } = await createApiKey(db, { name: "test-agent", callerId: "agent-1" });
    expect(keyId).toBeTruthy();
    expect(rawKey.startsWith("mgk_")).toBe(true);

    const result = await verifyApiKey(db, rawKey);
    expect(result).not.toBeNull();
    expect(result!.callerId).toBe("agent-1");
  });

  it("returns null for invalid key", async () => {
    const result = await verifyApiKey(db, "mgk_invalid");
    expect(result).toBeNull();
  });

  it("returns null for revoked key", async () => {
    const { keyId, rawKey } = await createApiKey(db, { name: "revoke-me", callerId: "agent-2" });
    await revokeApiKey(db, keyId);
    const result = await verifyApiKey(db, rawKey);
    expect(result).toBeNull();
  });
});

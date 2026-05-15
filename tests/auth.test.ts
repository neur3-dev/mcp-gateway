import { describe, it, expect, beforeAll } from "bun:test";
import { createApiKey, verifyApiKey, revokeApiKey, listKeys } from "../src/auth/api-keys";
import { getDb } from "../src/db/client";
import { apiKeys, auditLog } from "../src/db/schema";
import { checkRbac, createPolicy, listPolicies, removePolicy } from "../src/auth/rbac";
import { rbacPolicies } from "../src/db/schema";
import { nanoid } from "nanoid";
import { listAuditEvents } from "../src/auth/audit";

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

describe("RBAC", () => {
  const db2 = getDb("postgresql://gateway:gateway@localhost:5432/mcp_gateway_test");

  beforeAll(async () => {
    await db2.delete(rbacPolicies);
  });

  it("allows a tool that matches an allow policy", async () => {
    await createPolicy(db2, { callerId: "agent-1", toolPattern: "sqlite/*", effect: "allow" });
    const result = await checkRbac(db2, "agent-1", "sqlite/read_query");
    expect(result).toBe("allow");
  });

  it("denies a tool with no matching policy (default deny)", async () => {
    const result = await checkRbac(db2, "agent-1", "github/create_issue");
    expect(result).toBe("deny");
  });

  it("deny policy overrides allow for specific tool", async () => {
    await db2.delete(rbacPolicies);
    await createPolicy(db2, { callerId: "agent-1", toolPattern: "sqlite/*", effect: "allow" });
    await createPolicy(db2, { callerId: "agent-1", toolPattern: "sqlite/write_query", effect: "deny" });
    const result = await checkRbac(db2, "agent-1", "sqlite/write_query");
    expect(result).toBe("deny");
  });
});

describe("listKeys", () => {
  const db = getDb("postgresql://gateway:gateway@localhost:5432/mcp_gateway_test");

  beforeAll(async () => {
    await db.delete(apiKeys);
    await createApiKey(db, { name: "alpha", callerId: "lk-test", bcryptRounds: 4 });
    await createApiKey(db, { name: "beta", callerId: "lk-test", bcryptRounds: 4 });
  });

  it("returns all keys including both inserted rows", async () => {
    const rows = await listKeys(db);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const names = rows.map((r) => r.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });
});

describe("listPolicies", () => {
  const db = getDb("postgresql://gateway:gateway@localhost:5432/mcp_gateway_test");

  beforeAll(async () => {
    await db.delete(rbacPolicies);
    await createPolicy(db, { callerId: "lp-a", toolPattern: "sqlite/*", effect: "allow" });
    await createPolicy(db, { callerId: "lp-a", toolPattern: "github/*", effect: "deny" });
    await createPolicy(db, { callerId: "lp-b", toolPattern: "*", effect: "allow" });
  });

  it("returns all policies when no callerId given", async () => {
    const rows = await listPolicies(db);
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("filters to caller when callerId provided", async () => {
    const rows = await listPolicies(db, "lp-a");
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.caller_id === "lp-a")).toBe(true);
  });
});

describe("removePolicy", () => {
  const db = getDb("postgresql://gateway:gateway@localhost:5432/mcp_gateway_test");
  let policyId: string;

  beforeAll(async () => {
    const result = await createPolicy(db, { callerId: "rp-test", toolPattern: "test/*", effect: "allow" });
    policyId = result.id;
  });

  it("deletes the policy and returns true", async () => {
    const found = await removePolicy(db, policyId);
    expect(found).toBe(true);
    const remaining = await listPolicies(db, "rp-test");
    expect(remaining.some((r) => r.id === policyId)).toBe(false);
  });

  it("returns false for an ID that does not exist", async () => {
    const found = await removePolicy(db, "no-such-id");
    expect(found).toBe(false);
  });
});

describe("listAuditEvents", () => {
  const db = getDb("postgresql://gateway:gateway@localhost:5432/mcp_gateway_test");
  const testCaller = `la-test-${Date.now()}`;

  beforeAll(async () => {
    // audit_log is append-only (no DELETE). Use a unique testCaller for isolation.
    await db.insert(auditLog).values([
      { id: nanoid(16), caller_id: testCaller, key_id: "k1", tool: "sqlite/read", server: "sqlite", method: "tools/call", status: "ok", latency_ms: 10 },
      { id: nanoid(16), caller_id: testCaller, key_id: "k1", tool: "github/list", server: "github", method: "tools/call", status: "denied" },
      { id: nanoid(16), caller_id: "other-caller", key_id: "k2", tool: "slack/post", server: "slack", method: "tools/call", status: "ok" },
    ]);
  });

  it("filters by callerId", async () => {
    const rows = await listAuditEvents(db, { callerId: testCaller });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.caller_id === testCaller)).toBe(true);
  });

  it("respects the limit parameter", async () => {
    const rows = await listAuditEvents(db, { callerId: testCaller, limit: 1 });
    expect(rows.length).toBe(1);
  });

  it("returns up to limit rows when no callerId given", async () => {
    const rows = await listAuditEvents(db, { limit: 2 });
    expect(rows.length).toBeLessThanOrEqual(2);
  });
});

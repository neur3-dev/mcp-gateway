import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  key_hash: text("key_hash").notNull(),
  key_prefix: text("key_prefix"),   // first 8 chars after "mgk_" — enables O(1) lookup before bcrypt
  caller_id: text("caller_id").notNull(),
  created_at: timestamp("created_at").defaultNow(),
  revoked: boolean("revoked").default(false),
  last_used_at: timestamp("last_used_at"),
});

export const rbacPolicies = pgTable("rbac_policies", {
  id: text("id").primaryKey(),
  caller_id: text("caller_id").notNull(),
  tool_pattern: text("tool_pattern").notNull(),
  effect: text("effect").notNull(),
  created_at: timestamp("created_at").defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  caller_id: text("caller_id").notNull(),
  key_id: text("key_id").notNull(),
  tool: text("tool").notNull(),
  server: text("server").notNull(),
  method: text("method").notNull(),
  args_hash: text("args_hash"),
  latency_ms: integer("latency_ms"),
  status: text("status").notNull(),
  error_message: text("error_message"),
  recorded_at: timestamp("recorded_at").defaultNow(),
});

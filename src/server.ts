import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { sql } from "drizzle-orm";
import { loadConfig } from "./config/loader";
import { getDb, endDb } from "./db/client";
import { getRedis, endRedis } from "./redis/client";
import { verifyApiKey } from "./auth/api-keys";
import { mountSSERoutes, closeAllSessions } from "./transport/sse-server";
import { buildMCPServer, sweepRateLimiters, closePool, getDownstreamHealth } from "./multiplexer/router";

const configPath = process.env.CONFIG_PATH ?? "./config.yaml";
const config = loadConfig(configPath);
const db = getDb(config.audit.postgres_url);
const redis = getRedis(config.redis?.url ?? process.env.REDIS_URL);

// ── CORS ─────────────────────────────────────────────────────────────────────
const corsOrigins = config.gateway.cors_origins;
const corsOptions =
  corsOrigins && corsOrigins.length > 0 && !corsOrigins.includes("*")
    ? { origin: corsOrigins }
    : {};

const app = new Elysia().use(cors(corsOptions));

// ── Routes ────────────────────────────────────────────────────────────────────
app.get("/health", () => ({ status: "ok" }));

app.get("/ready", async () => {
  const checks: Record<string, string> = {};

  // DB check
  try {
    await db.execute(sql`SELECT 1`);
    checks.db = "ok";
  } catch (err) {
    checks.db = `error: ${(err as Error).message}`;
  }

  // Redis check (optional)
  if (redis) {
    try {
      await redis.ping();
      checks.redis = "ok";
    } catch (err) {
      checks.redis = `error: ${(err as Error).message}`;
    }
  }

  // Downstream server circuit breaker state
  const serverHealth = await getDownstreamHealth(config, redis);
  Object.assign(checks, serverHealth);

  const dbOk = checks.db === "ok";
  const redisOk = !redis || checks.redis === "ok";
  const downstreamsOk = config.servers.every((s) => checks[`server:${s.name}`] === "ok");

  const requireRedis = config.readiness?.require_redis ?? false;
  const requireDownstreams = config.readiness?.require_downstreams ?? false;

  const ready =
    dbOk &&
    (!requireRedis || redisOk) &&
    (!requireDownstreams || downstreamsOk);

  return new Response(
    JSON.stringify({ ...checks, status: ready ? "ready" : "not_ready" }),
    {
      status: ready ? 200 : 503,
      headers: { "Content-Type": "application/json" },
    }
  );
});

if (process.env.NODE_ENV !== "production") {
  app.get("/debug/config", () => ({
    servers: config.servers.map((s) => ({ name: s.name, transport: s.transport })),
  }));
}

mountSSERoutes(
  app as Parameters<typeof mountSSERoutes>[0],
  (caller) => buildMCPServer(config, caller, db, redis),
  (rawKey) => verifyApiKey(db, rawKey),
  config.auth.api_key_header
);

app.onError(({ error, set }) => {
  set.status = 500;
  const isProd = process.env.NODE_ENV === "production";
  return { error: isProd ? "Internal server error" : (error as Error).message };
});

// ── Startup ───────────────────────────────────────────────────────────────────
app.listen({ port: config.gateway.port, hostname: config.gateway.host });
console.log(`Gateway listening on ${config.gateway.host}:${config.gateway.port}`);

const sweepInterval = setInterval(() => sweepRateLimiters(), 60_000);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] ${signal} received — draining...`);
  clearInterval(sweepInterval);
  await closeAllSessions();
  await closePool();
  await endRedis();
  await endDb();
  console.log("[shutdown] clean exit");
  process.exit(0);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

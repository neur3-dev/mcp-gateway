import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { loadConfig } from "./config/loader";
import { getDb } from "./db/client";
import { getRedis } from "./redis/client";
import { verifyApiKey } from "./auth/api-keys";
import { mountSSERoutes } from "./transport/sse-server";
import { buildMCPServer, sweepRateLimiters } from "./multiplexer/router";

const configPath = process.env.CONFIG_PATH ?? "./config.yaml";
const config = loadConfig(configPath);
const db = getDb(config.audit.postgres_url);
const redis = getRedis(config.redis?.url ?? process.env.REDIS_URL);

const app = new Elysia().use(cors());

app.get("/health", () => ({ status: "ok" }));

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

app.listen({ port: config.gateway.port, hostname: config.gateway.host });
console.log(`Gateway listening on ${config.gateway.host}:${config.gateway.port}`);

setInterval(() => sweepRateLimiters(), 60_000);

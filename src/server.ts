import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { loadConfig } from "./config/loader";
import { getDb } from "./db/client";
import { verifyApiKey } from "./auth/api-keys";
import { mountSSERoutes } from "./transport/sse-server";
import { buildMCPServer } from "./multiplexer/router";

const configPath = process.env.CONFIG_PATH ?? "./config.yaml";
const config = loadConfig(configPath);
const db = getDb(config.audit.postgres_url);

const app = new Elysia()
  .use(cors())
  .get("/health", () => ({ status: "ok" }));

mountSSERoutes(
  app,
  (caller) => buildMCPServer(config, caller),
  (rawKey) => verifyApiKey(db, rawKey)
);

app.listen({ port: config.gateway.port, hostname: config.gateway.host });
console.log(`Gateway listening on ${config.gateway.host}:${config.gateway.port}`);

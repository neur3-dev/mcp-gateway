import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { connectStdio, type DownstreamClient } from "../transport/stdio-client";
import { connectSSE } from "../transport/sse-client";
import { aggregateTools, aggregateResources } from "./aggregator";
import { parseQualifiedTool, parseQualifiedResource } from "./namespace";
import type { GatewayConfig, CallerContext } from "../types";
import { checkRbac } from "../auth/rbac";
import { getDb } from "../db/client";
import type { Redis } from "../redis/client";
import { RateLimiter } from "../middleware/rate-limiter";
import { CircuitBreaker } from "../middleware/circuit-breaker";
import { writeAuditEvent } from "../middleware/audit-logger";

async function initDownstream(config: GatewayConfig): Promise<DownstreamClient[]> {
  return Promise.all(
    config.servers.map((s) => (s.transport === "stdio" ? connectStdio(s) : connectSSE(s)))
  );
}

let _pool: DownstreamClient[] | null = null;

async function getPool(config: GatewayConfig): Promise<DownstreamClient[]> {
  if (!_pool) _pool = await initDownstream(config);
  return _pool;
}

let _keyRateLimiter: RateLimiter | null = null;
let _serverRateLimiter: RateLimiter | null = null;

function getKeyRateLimiter(config: GatewayConfig, redis: Redis | null): RateLimiter {
  if (!_keyRateLimiter) _keyRateLimiter = new RateLimiter({ rps: config.rate_limit.default_rps, burst: config.rate_limit.burst, redis });
  return _keyRateLimiter;
}

function getServerRateLimiter(config: GatewayConfig, redis: Redis | null): RateLimiter {
  if (!_serverRateLimiter) _serverRateLimiter = new RateLimiter({ rps: config.rate_limit.per_server_rps, burst: config.rate_limit.per_server_rps * 2, redis });
  return _serverRateLimiter;
}

let _circuitBreaker: CircuitBreaker | null = null;

function getCircuitBreaker(config: GatewayConfig, redis: Redis | null): CircuitBreaker {
  if (!_circuitBreaker) _circuitBreaker = new CircuitBreaker({ failureThreshold: config.circuit_breaker.failure_threshold, resetTimeoutMs: config.circuit_breaker.reset_timeout_ms, redis });
  return _circuitBreaker;
}

export function buildMCPServer(
  config: GatewayConfig,
  caller: CallerContext,
  db: ReturnType<typeof getDb>,
  redis: Redis | null = null
): Server {
  const server = new Server(
    { name: "mcp-gateway", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const pool = await getPool(config);
    const cb = getCircuitBreaker(config, redis);
    const open = await Promise.all(pool.map((ds) => cb.isOpen(ds.name)));
    const healthyPool = pool.filter((_, i) => !open[i]);
    const serverTools = await Promise.allSettled(
      healthyPool.map(async (ds) => {
        const result = await ds.client.listTools();
        return { server: ds.name, tools: result.tools };
      })
    );
    const available = serverTools
      .filter((r): r is PromiseFulfilledResult<{ server: string; tools: any[] }> => r.status === "fulfilled")
      .map((r) => r.value);

    return { tools: aggregateTools(available) };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const pool = await getPool(config);
    const cb = getCircuitBreaker(config, redis);
    const open = await Promise.all(pool.map((ds) => cb.isOpen(ds.name)));
    const healthyPool = pool.filter((_, i) => !open[i]);
    const serverResources = await Promise.allSettled(
      healthyPool.map(async (ds) => {
        const result = await ds.client.listResources();
        return { server: ds.name, resources: result.resources };
      })
    );
    const available = serverResources
      .filter((r): r is PromiseFulfilledResult<{ server: string; resources: any[] }> => r.status === "fulfilled")
      .map((r) => r.value);

    return { resources: aggregateResources(available) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { server: serverName, tool } = parseQualifiedTool(req.params.name);

    // Check RBAC — deny by default
    const rbacResult = await checkRbac(db, caller.callerId, req.params.name);
    if (rbacResult === "deny") {
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.name,
        server: req.params.name.includes("/") ? req.params.name.split("/")[0] : "unknown",
        method: "tools/call",
        status: "denied",
        errorMessage: `RBAC denied for caller "${caller.callerId}"`,
      });
      throw new Error(`Permission denied: caller "${caller.callerId}" cannot call "${req.params.name}"`);
    }

    if (!await getKeyRateLimiter(config, redis).checkAsync(caller.callerId)) {
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.name,
        server: req.params.name.includes("/") ? req.params.name.split("/")[0] : "unknown",
        method: "tools/call",
        status: "rate_limited",
        errorMessage: `Rate limit exceeded for caller "${caller.callerId}"`,
      });
      throw new Error(`Rate limit exceeded for caller "${caller.callerId}"`);
    }

    if (!await getServerRateLimiter(config, redis).checkAsync(serverName)) {
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.name,
        server: serverName,
        method: "tools/call",
        status: "rate_limited",
        errorMessage: `Rate limit exceeded for server "${serverName}"`,
      });
      throw new Error(`Rate limit exceeded for server "${serverName}"`);
    }

    if (await getCircuitBreaker(config, redis).isOpen(serverName)) {
      throw new Error(`Server "${serverName}" is currently unavailable (circuit open)`);
    }

    const pool = await getPool(config);
    const ds = pool.find((d) => d.name === serverName);
    if (!ds) throw new Error(`Unknown server: "${serverName}"`);

    const start = Date.now();
    try {
      const result = await ds.client.callTool({ name: tool, arguments: req.params.arguments });
      await getCircuitBreaker(config, redis).recordSuccess(serverName);
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.name,
        server: serverName,
        method: "tools/call",
        args: req.params.arguments,
        latencyMs: Date.now() - start,
        status: "ok",
      });
      return result;
    } catch (err) {
      await getCircuitBreaker(config, redis).recordFailure(serverName);
      writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.name,
        server: serverName,
        method: "tools/call",
        latencyMs: Date.now() - start,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
      throw err;
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { server: serverName, uri } = parseQualifiedResource(req.params.uri);
    const pool = await getPool(config);
    const ds = pool.find((d) => d.name === serverName);
    if (!ds) throw new Error(`Unknown server: "${serverName}"`);

    return ds.client.readResource({ uri });
  });

  return server;
}

export function sweepRateLimiters(): void {
  _keyRateLimiter?.sweep();
  _serverRateLimiter?.sweep();
}

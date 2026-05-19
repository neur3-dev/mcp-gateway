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
import { getCallerPolicies, checkRbacWithPolicies } from "../auth/rbac";
import { getDb } from "../db/client";
import type { Redis } from "../redis/client";
import { RateLimiter } from "../middleware/rate-limiter";
import { CircuitBreaker } from "../middleware/circuit-breaker";
import { writeAuditEvent, type AuditConfig } from "../middleware/audit-logger";

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
  if (!_keyRateLimiter) _keyRateLimiter = new RateLimiter({
    rps: config.rate_limit.default_rps,
    burst: config.rate_limit.burst,
    redis,
    failClosed: config.redis?.fail_closed ?? false,
  });
  return _keyRateLimiter;
}

function getServerRateLimiter(config: GatewayConfig, redis: Redis | null): RateLimiter {
  if (!_serverRateLimiter) _serverRateLimiter = new RateLimiter({
    rps: config.rate_limit.per_server_rps,
    burst: config.rate_limit.per_server_rps * 2,
    redis,
    failClosed: config.redis?.fail_closed ?? false,
  });
  return _serverRateLimiter;
}

let _circuitBreaker: CircuitBreaker | null = null;

function getCircuitBreaker(config: GatewayConfig, redis: Redis | null): CircuitBreaker {
  if (!_circuitBreaker) _circuitBreaker = new CircuitBreaker({
    failureThreshold: config.circuit_breaker.failure_threshold,
    resetTimeoutMs: config.circuit_breaker.reset_timeout_ms,
    redis,
    failClosed: config.circuit_breaker.fail_closed ?? false,
  });
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

  const auditCfg: AuditConfig = config.audit;

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
    const failedToolServers = healthyPool
      .filter((_, i) => serverTools[i].status === "rejected")
      .map((ds) => ds.name);

    const policies = await getCallerPolicies(db, caller.callerId);
    const allTools = aggregateTools(available);
    const allowedTools = allTools.filter((t) => checkRbacWithPolicies(policies, t.name) === "allow");

    await writeAuditEvent(db, {
      callerId: caller.callerId,
      keyId: caller.keyId,
      tool: "tools/list",
      server: "gateway",
      method: "tools/list",
      status: failedToolServers.length > 0 ? "partial_ok" : "ok",
      errorMessage: failedToolServers.length > 0
        ? `${failedToolServers.length} server(s) failed: ${failedToolServers.join(", ")}`
        : undefined,
    }, auditCfg);

    return { tools: allowedTools };
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
    const failedResourceServers = healthyPool
      .filter((_, i) => serverResources[i].status === "rejected")
      .map((ds) => ds.name);

    const policies = await getCallerPolicies(db, caller.callerId);
    const allResources = aggregateResources(available);
    const allowedResources = allResources.filter((r) => {
      const serverName = r.uri.split("::")[0];
      return checkRbacWithPolicies(policies, `${serverName}/resources`) === "allow";
    });

    await writeAuditEvent(db, {
      callerId: caller.callerId,
      keyId: caller.keyId,
      tool: "resources/list",
      server: "gateway",
      method: "resources/list",
      status: failedResourceServers.length > 0 ? "partial_ok" : "ok",
      errorMessage: failedResourceServers.length > 0
        ? `${failedResourceServers.length} server(s) failed: ${failedResourceServers.join(", ")}`
        : undefined,
    }, auditCfg);

    return { resources: allowedResources };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { server: serverName, tool } = parseQualifiedTool(req.params.name);

    const rbacResult = await checkRbacWithPolicies(
      await getCallerPolicies(db, caller.callerId),
      req.params.name
    );
    if (rbacResult === "deny") {
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.name,
        server: serverName,
        method: "tools/call",
        status: "denied",
        errorMessage: `RBAC denied for caller "${caller.callerId}"`,
      }, auditCfg);
      throw new Error(`Permission denied: caller "${caller.callerId}" cannot call "${req.params.name}"`);
    }

    if (!await getKeyRateLimiter(config, redis).checkAsync(caller.callerId)) {
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.name,
        server: serverName,
        method: "tools/call",
        status: "rate_limited",
        errorMessage: `Rate limit exceeded for caller "${caller.callerId}"`,
      }, auditCfg);
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
      }, auditCfg);
      throw new Error(`Rate limit exceeded for server "${serverName}"`);
    }

    if (await getCircuitBreaker(config, redis).isOpen(serverName)) {
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.name,
        server: serverName,
        method: "tools/call",
        status: "circuit_open",
        errorMessage: `Circuit open for server "${serverName}"`,
      }, auditCfg);
      throw new Error(`Server "${serverName}" is currently unavailable (circuit open)`);
    }

    const pool = await getPool(config);
    const ds = pool.find((d) => d.name === serverName);
    if (!ds) throw new Error(`Unknown server: "${serverName}"`);

    await ds.ensureFresh?.();

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
      }, auditCfg);
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
      }, auditCfg).catch(() => {});
      throw err;
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { server: serverName, uri } = parseQualifiedResource(req.params.uri);
    const rbacKey = `${serverName}/resources`;

    const rbacResult = await checkRbacWithPolicies(
      await getCallerPolicies(db, caller.callerId),
      rbacKey
    );
    if (rbacResult === "deny") {
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.uri,
        server: serverName,
        method: "resources/read",
        status: "denied",
        errorMessage: `RBAC denied for caller "${caller.callerId}"`,
      }, auditCfg);
      throw new Error(`Permission denied: caller "${caller.callerId}" cannot read resources from "${serverName}"`);
    }

    if (!await getKeyRateLimiter(config, redis).checkAsync(caller.callerId)) {
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.uri,
        server: serverName,
        method: "resources/read",
        status: "rate_limited",
        errorMessage: `Rate limit exceeded for caller "${caller.callerId}"`,
      }, auditCfg);
      throw new Error(`Rate limit exceeded for caller "${caller.callerId}"`);
    }

    if (!await getServerRateLimiter(config, redis).checkAsync(serverName)) {
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.uri,
        server: serverName,
        method: "resources/read",
        status: "rate_limited",
        errorMessage: `Rate limit exceeded for server "${serverName}"`,
      }, auditCfg);
      throw new Error(`Rate limit exceeded for server "${serverName}"`);
    }

    if (await getCircuitBreaker(config, redis).isOpen(serverName)) {
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.uri,
        server: serverName,
        method: "resources/read",
        status: "circuit_open",
        errorMessage: `Circuit open for server "${serverName}"`,
      }, auditCfg);
      throw new Error(`Server "${serverName}" is currently unavailable (circuit open)`);
    }

    const pool = await getPool(config);
    const ds = pool.find((d) => d.name === serverName);
    if (!ds) throw new Error(`Unknown server: "${serverName}"`);

    await ds.ensureFresh?.();

    const start = Date.now();
    try {
      const result = await ds.client.readResource({ uri });
      await getCircuitBreaker(config, redis).recordSuccess(serverName);
      await writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.uri,
        server: serverName,
        method: "resources/read",
        latencyMs: Date.now() - start,
        status: "ok",
      }, auditCfg);
      return result;
    } catch (err) {
      await getCircuitBreaker(config, redis).recordFailure(serverName);
      writeAuditEvent(db, {
        callerId: caller.callerId,
        keyId: caller.keyId,
        tool: req.params.uri,
        server: serverName,
        method: "resources/read",
        latencyMs: Date.now() - start,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      }, auditCfg).catch(() => {});
      throw err;
    }
  });

  return server;
}

export function sweepRateLimiters(): void {
  _keyRateLimiter?.sweep();
  _serverRateLimiter?.sweep();
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await Promise.allSettled(_pool.map((ds) => ds.close()));
    _pool = null;
  }
}

const PROBE_TIMEOUT_MS = 3000;
const PROBE_CACHE_TTL_MS = 10_000; // avoid hammering downstreams on frequent readiness checks

let _healthCache: { results: Record<string, string>; ts: number } | null = null;

export async function getDownstreamHealth(
  config: GatewayConfig,
  redis: Redis | null
): Promise<Record<string, string>> {
  if (_healthCache && Date.now() - _healthCache.ts < PROBE_CACHE_TTL_MS) {
    return _healthCache.results;
  }

  const cb = getCircuitBreaker(config, redis);
  let pool: DownstreamClient[];
  try {
    pool = await getPool(config);
  } catch {
    const out: Record<string, string> = {};
    config.servers.forEach((s) => { out[`server:${s.name}`] = "not_connected"; });
    return out;
  }

  const results: Record<string, string> = {};
  await Promise.all(
    config.servers.map(async (s) => {
      if (await cb.isOpen(s.name)) {
        results[`server:${s.name}`] = "circuit_open";
        return;
      }
      const ds = pool.find((d) => d.name === s.name);
      if (!ds) {
        results[`server:${s.name}`] = "not_connected";
        return;
      }
      try {
        await Promise.race([
          ds.client.listTools(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("probe timeout")), PROBE_TIMEOUT_MS)
          ),
        ]);
        results[`server:${s.name}`] = "ok";
      } catch (err) {
        results[`server:${s.name}`] = `unreachable: ${err instanceof Error ? err.message : String(err)}`;
      }
    })
  );

  _healthCache = { results, ts: Date.now() };
  return results;
}

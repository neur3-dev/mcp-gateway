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

export function buildMCPServer(config: GatewayConfig, caller: CallerContext): Server {
  const server = new Server(
    { name: "mcp-gateway", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const pool = await getPool(config);
    const serverTools = await Promise.allSettled(
      pool.map(async (ds) => {
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
    const serverResources = await Promise.allSettled(
      pool.map(async (ds) => {
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
    const pool = await getPool(config);
    const ds = pool.find((d) => d.name === serverName);
    if (!ds) throw new Error(`Unknown server: "${serverName}"`);

    const result = await ds.client.callTool({ name: tool, arguments: req.params.arguments });
    return result;
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

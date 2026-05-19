import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StdioServerConfig } from "../types";

export interface DownstreamClient {
  client: Client;
  name: string;
  close: () => Promise<void>;
  ensureFresh?: () => Promise<void>;
}

export async function connectStdio(server: StdioServerConfig): Promise<DownstreamClient> {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    // Pass only explicitly configured vars + PATH. Never expose DATABASE_URL, REDIS_URL,
    // gateway secrets or unrelated host env to downstream stdio processes.
    env: { PATH: process.env.PATH ?? "", ...(server.env ?? {}) } as Record<string, string>,
  });

  const client = new Client({ name: "mcp-gateway", version: "1.0.0" });
  await client.connect(transport);

  return {
    client,
    name: server.name,
    close: () => client.close(),
  };
}

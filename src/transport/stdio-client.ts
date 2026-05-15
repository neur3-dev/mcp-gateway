import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StdioServerConfig } from "../types";

export interface DownstreamClient {
  client: Client;
  name: string;
  close: () => Promise<void>;
}

export async function connectStdio(server: StdioServerConfig): Promise<DownstreamClient> {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
  });

  const client = new Client({ name: "mcp-gateway", version: "1.0.0" });
  await client.connect(transport);

  return {
    client,
    name: server.name,
    close: () => client.close(),
  };
}

import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { SSEServerConfig } from "../types";
import type { DownstreamClient } from "./stdio-client";

export async function connectSSE(server: SSEServerConfig): Promise<DownstreamClient> {
  const headers: Record<string, string> = { ...(server.headers ?? {}) };

  if (server.oauth2) {
    const { token_url, client_id, client_secret, scopes } = server.oauth2;
    const resp = await fetch(token_url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id,
        client_secret,
        scope: scopes.join(" "),
      }),
    });
    if (!resp.ok) throw new Error(`OAuth2 token fetch failed for server "${server.name}": ${resp.status}`);
    const { access_token } = (await resp.json()) as { access_token: string };
    headers["Authorization"] = `Bearer ${access_token}`;
  }

  const transport = new SSEClientTransport(new URL(server.url), { requestInit: { headers } });
  const client = new Client({ name: "mcp-gateway", version: "1.0.0" });
  await client.connect(transport);

  return {
    client,
    name: server.name,
    close: () => client.close(),
  };
}

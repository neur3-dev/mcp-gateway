import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { SSEServerConfig, OAuth2Config } from "../types";
import type { DownstreamClient } from "./stdio-client";

const TOKEN_REFRESH_BUFFER_MS = 60_000; // refresh 60s before expiry

interface TokenState {
  token: string;
  expiresAt: number; // absolute ms timestamp
}

async function fetchToken(cfg: OAuth2Config, serverName: string): Promise<TokenState> {
  const resp = await fetch(cfg.token_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      scope: cfg.scopes.join(" "),
    }),
  });
  if (!resp.ok) throw new Error(`OAuth2 token fetch failed for server "${serverName}": ${resp.status}`);
  const body = (await resp.json()) as { access_token: string; expires_in?: number };
  const ttlMs = (body.expires_in ?? 3600) * 1000;
  return { token: body.access_token, expiresAt: Date.now() + ttlMs - TOKEN_REFRESH_BUFFER_MS };
}

async function buildClient(server: SSEServerConfig, token?: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const headers: Record<string, string> = { ...(server.headers ?? {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const transport = new SSEClientTransport(new URL(server.url), { requestInit: { headers } });
  const client = new Client({ name: "mcp-gateway", version: "0.1.0-beta" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

export async function connectSSE(server: SSEServerConfig): Promise<DownstreamClient> {
  if (!server.oauth2) {
    const { client, close } = await buildClient(server);
    return { client, name: server.name, close };
  }

  let tokenState = await fetchToken(server.oauth2, server.name);
  let inner = await buildClient(server, tokenState.token);
  let refreshLock: Promise<void> | null = null;

  return {
    name: server.name,
    get client() { return inner.client; },
    close: () => inner.close(),
    ensureFresh: async () => {
      if (Date.now() < tokenState.expiresAt) return;
      // Coalesce concurrent refreshes — all waiters share the same refresh promise.
      if (refreshLock) return refreshLock;
      refreshLock = (async () => {
        if (Date.now() < tokenState.expiresAt) return; // re-check after acquiring lock
        await inner.close();
        tokenState = await fetchToken(server.oauth2!, server.name);
        inner = await buildClient(server, tokenState.token);
      })().finally(() => { refreshLock = null; });
      return refreshLock;
    },
  };
}

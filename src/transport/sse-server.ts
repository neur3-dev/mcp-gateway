import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { randomUUID } from "crypto";
import type { CallerContext } from "../types";

interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
}

const sessions = new Map<string, Session>();

export function mountSSERoutes(
  app: { all: (path: string, handler: (ctx: { request: Request; set: { status: number } }) => Promise<Response | { error: string }>) => void },
  buildServer: (caller: CallerContext) => Server,
  getCallerFromKey: (rawKey: string) => Promise<(CallerContext & { keyId: string }) | null>
) {
  app.all("/mcp", async ({ request, set }) => {
    const rawKey = request.headers.get("X-API-Key") ?? "";
    const caller = await getCallerFromKey(rawKey);
    if (!caller) {
      set.status = 401;
      return { error: "Invalid or missing API key" } as unknown as Response;
    }

    const sessionId = request.headers.get("mcp-session-id");
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    if (existing) {
      return existing.transport.handleRequest(request);
    }

    // New session
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server });
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
      },
    });

    const server = buildServer(caller);
    await server.connect(transport);

    return transport.handleRequest(request);
  });
}

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { randomUUID } from "crypto";
import type { CallerContext } from "../types";

const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS ?? "") || 4 * 60 * 60 * 1000; // 4 hours

interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
  callerId: string;
  keyId: string;
  timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, Session>();

function refreshTimer(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  clearTimeout(session.timer);
  session.timer = setTimeout(() => sessions.delete(id), SESSION_TTL_MS);
}

export function mountSSERoutes(
  app: { all: (path: string, handler: (ctx: { request: Request; set: { status: number } }) => Promise<Response | { error: string }>) => void },
  buildServer: (caller: CallerContext) => Server,
  getCallerFromKey: (rawKey: string) => Promise<(CallerContext & { keyId: string }) | null>,
  apiKeyHeader = "X-API-Key"
) {
  app.all("/mcp", async ({ request, set }) => {
    const rawKey = request.headers.get(apiKeyHeader) ?? "";
    const caller = await getCallerFromKey(rawKey);
    if (!caller) {
      set.status = 401;
      return { error: "Invalid or missing API key" } as unknown as Response;
    }

    const sessionId = request.headers.get("mcp-session-id");
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    if (existing) {
      if (existing.callerId !== caller.callerId || existing.keyId !== caller.keyId) {
        set.status = 403;
        return { error: "Session belongs to a different caller" } as unknown as Response;
      }
      refreshTimer(sessionId!);
      return existing.transport.handleRequest(request);
    }

    // New session
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        const timer = setTimeout(() => sessions.delete(id), SESSION_TTL_MS);
        sessions.set(id, { transport, server, callerId: caller.callerId, keyId: caller.keyId, timer });
      },
      onsessionclosed: (id) => {
        const s = sessions.get(id);
        if (s) clearTimeout(s.timer);
        sessions.delete(id);
      },
    });

    const server = buildServer(caller);
    await server.connect(transport);

    return transport.handleRequest(request);
  });
}

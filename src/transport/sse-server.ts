import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Elysia } from "elysia";
import type { CallerContext } from "../types";

const sessions = new Map<string, SSEServerTransport>();

export function mountSSERoutes(
  app: Elysia,
  buildServer: (caller: CallerContext) => Server,
  getCallerFromKey: (rawKey: string) => Promise<(CallerContext & { keyId: string }) | null>
) {
  app.get("/sse", async ({ request, set }) => {
    const rawKey = request.headers.get("X-API-Key") ?? "";
    const caller = await getCallerFromKey(rawKey);
    if (!caller) {
      set.status = 401;
      return { error: "Invalid or missing API key" };
    }

    const transport = new SSEServerTransport("/messages", set.response as Response);
    const server = buildServer(caller);
    sessions.set(transport.sessionId, transport);

    await server.connect(transport);
    return transport.response;
  });

  app.post("/messages", async ({ request, set }) => {
    const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
    const transport = sessions.get(sessionId);
    if (!transport) {
      set.status = 404;
      return { error: "Session not found" };
    }
    await transport.handlePostMessage(request);
    return new Response(null, { status: 202 });
  });
}

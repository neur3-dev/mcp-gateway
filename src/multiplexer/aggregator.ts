import { qualifyTool, qualifyResource } from "./namespace";

interface ToolEntry {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface ResourceEntry {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export function aggregateTools(
  serverTools: Array<{ server: string; tools: ToolEntry[] }>
): ToolEntry[] {
  return serverTools.flatMap(({ server, tools }) =>
    tools.map((t) => ({
      ...t,
      name: qualifyTool(server, t.name),
      description: `[${server}] ${t.description ?? ""}`.trim(),
    }))
  );
}

export function aggregateResources(
  serverResources: Array<{ server: string; resources: ResourceEntry[] }>
): ResourceEntry[] {
  return serverResources.flatMap(({ server, resources }) =>
    resources.map((r) => ({
      ...r,
      uri: qualifyResource(server, r.uri),
      description: `[${server}] ${r.description ?? ""}`.trim(),
    }))
  );
}

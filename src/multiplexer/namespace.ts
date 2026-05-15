export function qualifyTool(serverName: string, toolName: string): string {
  return `${serverName}/${toolName}`;
}

export function parseQualifiedTool(qualified: string): { server: string; tool: string } {
  const slash = qualified.indexOf("/");
  if (slash === -1) throw new Error(`Not a qualified tool name: "${qualified}"`);
  return {
    server: qualified.slice(0, slash),
    tool: qualified.slice(slash + 1),
  };
}

export function qualifyResource(serverName: string, uri: string): string {
  return `${serverName}::${uri}`;
}

export function parseQualifiedResource(qualified: string): { server: string; uri: string } {
  const sep = qualified.indexOf("::");
  if (sep === -1) throw new Error(`Not a qualified resource URI: "${qualified}"`);
  return {
    server: qualified.slice(0, sep),
    uri: qualified.slice(sep + 2),
  };
}

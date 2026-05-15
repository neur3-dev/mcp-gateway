import { describe, it, expect } from "bun:test";
import { qualifyTool, parseQualifiedTool, qualifyResource } from "../src/multiplexer/namespace";
import { aggregateTools, aggregateResources } from "../src/multiplexer/aggregator";

describe("namespace", () => {
  it("qualifies tool name with server prefix", () => {
    expect(qualifyTool("sqlite", "read_query")).toBe("sqlite/read_query");
  });

  it("parses qualified name back to server + tool", () => {
    const { server, tool } = parseQualifiedTool("github/create_issue");
    expect(server).toBe("github");
    expect(tool).toBe("create_issue");
  });

  it("handles tool names with slashes by taking first segment only", () => {
    const { server, tool } = parseQualifiedTool("sqlite/nested/path");
    expect(server).toBe("sqlite");
    expect(tool).toBe("nested/path");
  });

  it("qualifies resource URI", () => {
    expect(qualifyResource("gdrive", "file://doc.pdf")).toBe("gdrive::file://doc.pdf");
  });
});

describe("aggregator", () => {
  it("merges tools from multiple servers with namespace prefix", () => {
    const serverTools = [
      { server: "sqlite", tools: [{ name: "read_query", description: "Run SQL", inputSchema: {} }] },
      { server: "github", tools: [{ name: "create_issue", description: "Open issue", inputSchema: {} }] },
    ];
    const merged = aggregateTools(serverTools);
    expect(merged).toHaveLength(2);
    expect(merged[0].name).toBe("sqlite/read_query");
    expect(merged[1].name).toBe("github/create_issue");
  });

  it("prefixes descriptions with server name", () => {
    const serverTools = [
      { server: "sqlite", tools: [{ name: "read_query", description: "Run SQL", inputSchema: {} }] },
    ];
    const merged = aggregateTools(serverTools);
    expect(merged[0].description).toBe("[sqlite] Run SQL");
  });
});

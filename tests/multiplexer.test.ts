import { describe, it, expect } from "bun:test";
import { qualifyTool, parseQualifiedTool, qualifyResource } from "../src/multiplexer/namespace";

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

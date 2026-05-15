import { describe, it, expect } from "bun:test";
import { loadConfig } from "../src/config/loader";
import { writeFileSync, unlinkSync } from "fs";

describe("loadConfig", () => {
  it("parses YAML and interpolates env vars", () => {
    process.env.TEST_TOKEN = "secret123";
    const yaml = `
gateway:
  port: 3000
  host: "0.0.0.0"
  transport: "sse"
auth:
  api_key_header: "X-API-Key"
  bcrypt_rounds: 12
rate_limit:
  default_rps: 10
  burst: 20
  per_server_rps: 50
servers:
  - name: "github"
    transport: "sse"
    url: "https://example.com"
    headers:
      Authorization: "Bearer \${TEST_TOKEN}"
circuit_breaker:
  failure_threshold: 5
  reset_timeout_ms: 30000
audit:
  enabled: true
  redact_args: false
  postgres_url: "postgres://localhost/test"
`;
    writeFileSync("/tmp/test-config.yaml", yaml);
    const config = loadConfig("/tmp/test-config.yaml");
    expect(config.gateway.port).toBe(3000);
    expect(config.servers[0].headers?.Authorization).toBe("Bearer secret123");
    unlinkSync("/tmp/test-config.yaml");
  });

  it("throws on missing required fields", () => {
    writeFileSync("/tmp/bad-config.yaml", "gateway:\n  port: 3000\n");
    expect(() => loadConfig("/tmp/bad-config.yaml")).toThrow();
    unlinkSync("/tmp/bad-config.yaml");
  });
});

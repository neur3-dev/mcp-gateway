import { parse } from "yaml";
import { readFileSync } from "fs";
import type { GatewayConfig } from "../types";
import { decryptSecret } from "./secrets";

function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const val = process.env[key];
    if (val === undefined) throw new Error(`Missing env var: ${key}`);
    if (val.startsWith("enc:") && process.env.GATEWAY_SECRET_KEY) {
      return decryptSecret(val, process.env.GATEWAY_SECRET_KEY);
    }
    return val;
  });
}

function interpolateObject(obj: unknown): unknown {
  if (typeof obj === "string") return interpolateEnv(obj);
  if (Array.isArray(obj)) return obj.map(interpolateObject);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, interpolateObject(v)])
    );
  }
  return obj;
}

function validateConfig(config: GatewayConfig): void {
  // Gateway
  const port = config.gateway.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`gateway.port must be 1–65535, got: ${port}`);
  }
  if (!["sse", "stdio"].includes(config.gateway.transport)) {
    throw new Error(`gateway.transport must be "sse" or "stdio", got: "${config.gateway.transport}"`);
  }

  // Auth
  if (!config.auth.api_key_header?.trim()) {
    throw new Error("auth.api_key_header must not be empty");
  }
  if (!Number.isInteger(config.auth.bcrypt_rounds) || config.auth.bcrypt_rounds < 10) {
    throw new Error(`auth.bcrypt_rounds must be an integer >= 10, got: ${config.auth.bcrypt_rounds}`);
  }

  // Rate limits
  if (config.rate_limit.default_rps <= 0) throw new Error("rate_limit.default_rps must be > 0");
  if (config.rate_limit.burst <= 0) throw new Error("rate_limit.burst must be > 0");
  if (config.rate_limit.per_server_rps <= 0) throw new Error("rate_limit.per_server_rps must be > 0");

  // Circuit breaker
  if (config.circuit_breaker.failure_threshold <= 0) throw new Error("circuit_breaker.failure_threshold must be > 0");
  if (config.circuit_breaker.reset_timeout_ms <= 0) throw new Error("circuit_breaker.reset_timeout_ms must be > 0");

  // Servers
  if (!config.servers || config.servers.length === 0) throw new Error("At least one server must be configured");
  const names = config.servers.map((s) => s.name);
  const nameSet = new Set(names);
  if (names.length !== nameSet.size) throw new Error("Duplicate server names in config");

  for (const s of config.servers) {
    if (!s.name || !/^[a-zA-Z0-9_-]+$/.test(s.name)) {
      throw new Error(`Server name must be alphanumeric/underscore/hyphen, got: "${s.name}"`);
    }
    if (!["stdio", "sse"].includes(s.transport)) {
      throw new Error(`Server "${s.name}" has invalid transport: "${s.transport}"`);
    }
    if (s.transport === "stdio" && !(s as any).command) {
      throw new Error(`Server "${s.name}" uses stdio transport but is missing "command"`);
    }
    if (s.transport === "sse" && !(s as any).url) {
      throw new Error(`Server "${s.name}" uses sse transport but is missing "url"`);
    }
  }
}

export function loadConfig(path: string): GatewayConfig {
  const raw = readFileSync(path, "utf-8");
  const parsed = parse(raw) as Record<string, unknown>;
  const config = interpolateObject(parsed) as GatewayConfig;

  if (!config.gateway) throw new Error("Config missing: gateway");
  if (!config.servers || config.servers.length === 0) throw new Error("Config missing: servers");
  if (!config.auth) throw new Error("Config missing: auth");
  if (!config.rate_limit) throw new Error("Config missing: rate_limit");
  if (!config.circuit_breaker) throw new Error("Config missing: circuit_breaker");
  if (!config.audit) throw new Error("Config missing: audit");

  validateConfig(config);
  return config;
}

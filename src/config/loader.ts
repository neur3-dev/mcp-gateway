import { parse } from "yaml";
import { readFileSync } from "fs";
import type { GatewayConfig } from "../types";
import { decryptSecret } from "./secrets";

function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const val = process.env[key];
    if (val === undefined) throw new Error(`Missing env var: ${key}`);
    // Decrypt if the env var value is an encrypted secret
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

  return config;
}

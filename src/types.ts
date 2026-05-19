export interface CallerContext {
  callerId: string;
  keyId: string;
  // Access control is RBAC-based (rbac_policies table), not per-key scopes.
}

export interface MCPCall {
  method: string;        // e.g. "tools/call"
  params: Record<string, unknown>;
}

export interface StdioServerConfig {
  name: string;
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SSEServerConfig {
  name: string;
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
  oauth2?: OAuth2Config;
}

export type ServerConfig = StdioServerConfig | SSEServerConfig;

export interface OAuth2Config {
  token_url: string;
  client_id: string;
  client_secret: string;
  scopes: string[];
}

export interface GatewayConfig {
  gateway: {
    port: number;
    host: string;
    transport: "sse" | "stdio";
    // TLS is not implemented — terminate TLS at a reverse proxy (nginx/Caddy) in front of the gateway.
    cors_origins?: string[];  // restrict CORS; omit or ["*"] to allow all (dev default)
  };
  auth: { api_key_header: string; bcrypt_rounds: number };
  rate_limit: { default_rps: number; burst: number; per_server_rps: number };
  servers: ServerConfig[];
  circuit_breaker: {
    failure_threshold: number;
    reset_timeout_ms: number;
    // fail_closed: true — treat servers as unavailable when Redis state is unreadable.
    // Prevents stale in-memory fallback from masking a broken downstream. Default: false.
    fail_closed?: boolean;
  };
  audit: { enabled: boolean; redact_args: boolean; postgres_url: string };
  // fail_closed: deny requests when Redis is unreachable instead of falling back to in-memory.
  // Set true in production to prevent silent rate-limit bypass on Redis outage.
  redis?: { url: string; fail_closed?: boolean };
  readiness?: {
    require_redis?: boolean;       // fail /ready when Redis is unreachable. Default: false
    require_downstreams?: boolean; // fail /ready when any downstream probe fails. Default: false
  };
}

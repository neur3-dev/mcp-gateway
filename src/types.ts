export interface CallerContext {
  callerId: string;
  keyId: string;
  scopes: string[];   // list of allowed tool patterns, e.g. ["sqlite/*", "github/list_repos"]
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
    tls?: { enabled: boolean; cert: string; key: string };
  };
  auth: { api_key_header: string; bcrypt_rounds: number };
  rate_limit: { default_rps: number; burst: number; per_server_rps: number };
  servers: ServerConfig[];
  circuit_breaker: { failure_threshold: number; reset_timeout_ms: number };
  audit: { enabled: boolean; redact_args: boolean; postgres_url: string };
}

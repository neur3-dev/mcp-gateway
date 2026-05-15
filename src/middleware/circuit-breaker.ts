type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface ServerState {
  state: CircuitState;
  failures: number;
  openedAt?: number;
}

export class CircuitBreaker {
  private servers = new Map<string, ServerState>();
  private failureThreshold: number;
  private resetTimeoutMs: number;

  constructor(opts: { failureThreshold: number; resetTimeoutMs: number }) {
    this.failureThreshold = opts.failureThreshold;
    this.resetTimeoutMs = opts.resetTimeoutMs;
  }

  private getState(server: string): ServerState {
    if (!this.servers.has(server)) {
      this.servers.set(server, { state: "CLOSED", failures: 0 });
    }
    return this.servers.get(server)!;
  }

  isOpen(server: string): boolean {
    const s = this.getState(server);
    if (s.state === "CLOSED") return false;
    if (s.state === "OPEN") {
      if (s.openedAt && Date.now() - s.openedAt > this.resetTimeoutMs) {
        s.state = "HALF_OPEN";
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(server: string): void {
    const s = this.getState(server);
    s.state = "CLOSED";
    s.failures = 0;
    s.openedAt = undefined;
  }

  recordFailure(server: string): void {
    const s = this.getState(server);
    s.failures += 1;
    if (s.failures >= this.failureThreshold) {
      s.state = "OPEN";
      s.openedAt = Date.now();
    }
  }

  healthyServers(serverNames: string[]): string[] {
    return serverNames.filter((s) => !this.isOpen(s));
  }
}

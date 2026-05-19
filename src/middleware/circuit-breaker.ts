import type { Redis } from "../redis/client";

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
  private redis: Redis | null;
  private failClosed: boolean;

  constructor(opts: { failureThreshold: number; resetTimeoutMs: number; redis?: Redis | null; failClosed?: boolean }) {
    this.failureThreshold = opts.failureThreshold;
    this.resetTimeoutMs = opts.resetTimeoutMs;
    this.redis = opts.redis ?? null;
    this.failClosed = opts.failClosed ?? false;
  }

  async isOpen(server: string): Promise<boolean> {
    if (this.redis) {
      try {
        return await this.isOpenRedis(server);
      } catch {
        if (this.failClosed) return true;
        // Redis unavailable — fall back to in-memory
      }
    }
    return this.isOpenInMemory(server);
  }

  async recordSuccess(server: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.hmset(`cb:${server}`, { state: "CLOSED", failures: 0 });
        await this.redis.hdel(`cb:${server}`, "opened_at");
        return;
      } catch {
        if (this.failClosed) return; // don't corrupt in-memory state when Redis is the authority
        /* fall through */
      }
    }
    const s = this.getInMemoryState(server);
    s.state = "CLOSED";
    s.failures = 0;
    s.openedAt = undefined;
  }

  async recordFailure(server: string): Promise<void> {
    if (this.redis) {
      try {
        await this.recordFailureRedis(server);
        return;
      } catch {
        if (this.failClosed) return; // don't corrupt in-memory state when Redis is the authority
        /* fall through */
      }
    }
    this.recordFailureInMemory(server);
  }

  healthyServers(serverNames: string[]): string[] {
    // Sync helper used for list-tools filtering — uses in-memory state only.
    // For request routing the async isOpen is used.
    return serverNames.filter((s) => !this.isOpenInMemory(s));
  }

  // ── Redis helpers ────────────────────────────────────────────────────────

  private async isOpenRedis(server: string): Promise<boolean> {
    const key = `cb:${server}`;
    const [state, openedAt, failures] = await this.redis!.hmget(key, "state", "opened_at", "failures");

    if (!state || state === "CLOSED") return false;

    if (state === "OPEN") {
      if (openedAt && Date.now() - parseInt(openedAt) > this.resetTimeoutMs) {
        await this.redis!.hset(key, "state", "HALF_OPEN");
        return false;
      }
      return true;
    }

    return false; // HALF_OPEN — probe allowed
  }

  private async recordFailureRedis(server: string): Promise<void> {
    const key = `cb:${server}`;
    const failures = await this.redis!.hincrby(key, "failures", 1);
    if (failures >= this.failureThreshold) {
      await this.redis!.hmset(key, { state: "OPEN", opened_at: Date.now().toString() });
    }
    // Keep key alive for at least reset window + buffer
    await this.redis!.pexpire(key, this.resetTimeoutMs * 3);
  }

  // ── In-memory helpers ────────────────────────────────────────────────────

  private getInMemoryState(server: string): ServerState {
    if (!this.servers.has(server)) {
      this.servers.set(server, { state: "CLOSED", failures: 0 });
    }
    return this.servers.get(server)!;
  }

  private isOpenInMemory(server: string): boolean {
    const s = this.getInMemoryState(server);
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

  private recordFailureInMemory(server: string): void {
    const s = this.getInMemoryState(server);
    s.failures += 1;
    if (s.failures >= this.failureThreshold) {
      s.state = "OPEN";
      s.openedAt = Date.now();
    }
  }
}

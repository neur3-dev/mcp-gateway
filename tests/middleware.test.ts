import { describe, it, expect } from "bun:test";
import { RateLimiter } from "../src/middleware/rate-limiter";

describe("RateLimiter", () => {
  it("allows requests within the limit", () => {
    const rl = new RateLimiter({ rps: 5, burst: 5 });
    for (let i = 0; i < 5; i++) {
      expect(rl.check("key-1")).toBe(true);
    }
  });

  it("blocks requests that exceed burst", () => {
    const rl = new RateLimiter({ rps: 5, burst: 5 });
    for (let i = 0; i < 5; i++) rl.check("key-1");
    expect(rl.check("key-1")).toBe(false);
  });

  it("tracks separate buckets per key", () => {
    const rl = new RateLimiter({ rps: 2, burst: 2 });
    rl.check("key-a");
    rl.check("key-a");
    expect(rl.check("key-a")).toBe(false);
    expect(rl.check("key-b")).toBe(true);
  });
});

import { CircuitBreaker } from "../src/middleware/circuit-breaker";

describe("CircuitBreaker", () => {
  it("starts CLOSED (healthy)", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    expect(await cb.isOpen("server-1")).toBe(false);
  });

  it("opens after hitting failure threshold", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    await cb.recordFailure("server-1");
    await cb.recordFailure("server-1");
    await cb.recordFailure("server-1");
    expect(await cb.isOpen("server-1")).toBe(true);
  });

  it("resets to CLOSED on success", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    await cb.recordFailure("server-1");
    await cb.recordFailure("server-1");
    await cb.recordSuccess("server-1");
    expect(await cb.isOpen("server-1")).toBe(false);
  });
});

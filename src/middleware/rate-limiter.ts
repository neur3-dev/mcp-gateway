import type { Redis } from "../redis/client";

// Atomically refills and checks a token bucket stored in Redis.
// Returns 1 if the request is allowed, 0 if denied.
const TOKEN_BUCKET_LUA = `
local key      = KEYS[1]
local now_ms   = tonumber(ARGV[1])
local rps      = tonumber(ARGV[2])
local burst    = tonumber(ARGV[3])
local ttl_ms   = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens      = tonumber(data[1])
local last_refill = tonumber(data[2])

if not tokens then
  tokens      = burst
  last_refill = now_ms
end

local elapsed = (now_ms - last_refill) / 1000.0
tokens = math.min(burst, tokens + elapsed * rps)

local allowed = 0
if tokens >= 1 then
  tokens  = tokens - 1
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now_ms)
redis.call('PEXPIRE', key, ttl_ms)
return allowed
`;

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private rps: number;
  private burst: number;
  private redis: Redis | null;
  private failClosed: boolean;
  private ttlMs: number;

  constructor(opts: { rps: number; burst: number; redis?: Redis | null; failClosed?: boolean }) {
    this.rps = opts.rps;
    this.burst = opts.burst;
    this.redis = opts.redis ?? null;
    this.failClosed = opts.failClosed ?? false;
    this.ttlMs = Math.ceil((opts.burst / opts.rps) * 1000) + 2000;
  }

  // Synchronous in-memory check. Used by unit tests and when Redis is not configured.
  check(key: string): boolean {
    return this.checkInMemory(key);
  }

  // Async check — uses Redis when configured.
  // fail_closed=true: deny on Redis error (safe for production).
  // fail_closed=false (default): fall back to in-memory on Redis error.
  async checkAsync(key: string): Promise<boolean> {
    if (!this.redis) return this.checkInMemory(key);
    try {
      const result = await (this.redis as any).eval(
        TOKEN_BUCKET_LUA,
        1,
        `rl:${key}`,
        Date.now().toString(),
        this.rps.toString(),
        this.burst.toString(),
        this.ttlMs.toString()
      ) as number;
      return result === 1;
    } catch (err) {
      if (this.failClosed) {
        console.error("[rate-limiter] Redis error with fail_closed=true — denying request:", (err as Error).message);
        return false;
      }
      console.warn("[rate-limiter] Redis error, falling back to in-memory:", (err as Error).message);
      return this.checkInMemory(key);
    }
  }

  private checkInMemory(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.burst, lastRefill: now };
      this.buckets.set(key, bucket);
    }
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.burst, bucket.tokens + elapsed * this.rps);
    bucket.lastRefill = now;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  sweep(maxAgeMs = 60_000): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > maxAgeMs) this.buckets.delete(key);
    }
  }
}

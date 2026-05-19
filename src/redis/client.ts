import Redis from "ioredis";

let _redis: Redis | null = null;

export function getRedis(url?: string): Redis | null {
  if (!url) return null;
  if (_redis) return _redis;
  _redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  _redis.on("error", (err) => console.error("[redis]", err.message));
  return _redis;
}

export async function endRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}

export type { Redis };

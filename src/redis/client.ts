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

export type { Redis };

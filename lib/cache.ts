// Cache abstraction: uses Upstash Redis (REST) when configured, otherwise an
// in-memory LRU-ish fallback so the app works with zero extra setup. Used to
// cache /api/search-prices results for ~15 minutes per normalized query.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_MEMORY_ENTRIES = 500;
const memoryStore = new Map<string, CacheEntry<unknown>>();

function memoryGet<T>(key: string): T | undefined {
  const entry = memoryStore.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return undefined;
  }
  // Refresh recency for simple LRU-ish eviction.
  memoryStore.delete(key);
  memoryStore.set(key, entry);
  return entry.value as T;
}

function memorySet<T>(key: string, value: T, ttlSeconds: number): void {
  if (memoryStore.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryStore.keys().next().value;
    if (oldestKey !== undefined) memoryStore.delete(oldestKey);
  }
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function hasUpstashConfig(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

let upstashClientPromise: Promise<import("@upstash/redis").Redis> | null = null;

async function getUpstashClient() {
  if (!upstashClientPromise) {
    upstashClientPromise = import("@upstash/redis").then(
      ({ Redis }) =>
        new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL!,
          token: process.env.UPSTASH_REDIS_REST_TOKEN!,
        })
    );
  }
  return upstashClientPromise;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  if (hasUpstashConfig()) {
    try {
      const redis = await getUpstashClient();
      const value = await redis.get<T>(key);
      return value ?? undefined;
    } catch {
      // Fall through to memory cache on Redis errors rather than failing the request.
      return memoryGet<T>(key);
    }
  }
  return memoryGet<T>(key);
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (hasUpstashConfig()) {
    try {
      const redis = await getUpstashClient();
      await redis.set(key, value, { ex: ttlSeconds });
      return;
    } catch {
      // Fall through to memory cache on Redis errors.
    }
  }
  memorySet(key, value, ttlSeconds);
}

/** Test-only helper to reset the in-memory cache between test cases. */
export function __resetMemoryCacheForTests() {
  memoryStore.clear();
}

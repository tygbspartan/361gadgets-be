import { getRedisClient } from "../config/redis.config";

/*
 * The storefront (Next.js) caches catalog data for up to an hour (fetch cache
 * tag "catalog"), and its pages and sitemap are built from it. When products,
 * categories or brands change here, tell it to drop that cache so the change
 * shows on the site and in the sitemap right away.
 *   STOREFRONT_REVALIDATE_URL  e.g. http://127.0.0.1:3001/api/revalidate
 *   REVALIDATE_SECRET          shared with the storefront
 * Unset (e.g. in tests) = skipped. Failures never break the write.
 */
const CATALOG_PATTERN = /^(products|categories|brands):/;
async function notifyStorefront(): Promise<void> {
  const url = process.env.STOREFRONT_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The storefront still refreshes on its own within the hour.
  }
}

export const CacheService = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const client = getRedisClient();
      if (!client) return null;
      const data = await client.get(key);
      return data ? (JSON.parse(data) as T) : null;
    } catch {
      return null;
    }
  },

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      const client = getRedisClient();
      if (!client) return;
      await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      // Fail silently — cache miss is always safe
    }
  },

  // Fire-and-forget SET — call this when you don't want to block the response
  setBackground(key: string, value: unknown, ttlSeconds: number): void {
    void this.set(key, value, ttlSeconds);
  },

  async del(key: string): Promise<void> {
    try {
      const client = getRedisClient();
      if (!client) return;
      await client.del(key);
    } catch {}
  },

  // Delete all keys matching a pattern (e.g. "products:*")
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const client = getRedisClient();
      if (client) {
        let cursor = "0";
        do {
          const [nextCursor, keys] = await client.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            100,
          );
          cursor = nextCursor;
          if (keys.length > 0) {
            await client.del(...keys);
          }
        } while (cursor !== "0");
      }
    } catch {}
    // After the API cache is cleared, so the storefront refetches fresh data.
    if (CATALOG_PATTERN.test(pattern)) await notifyStorefront();
  },

  // Fire-and-forget invalidation — doesn't block the write response
  invalidatePatternBackground(pattern: string): void {
    void this.invalidatePattern(pattern);
  },
};

// TTL constants (seconds)
export const TTL = {
  PRODUCT_LIST: 300,    // 5 min
  PRODUCT_SLUG: 600,    // 10 min
  BRAND: 900,           // 15 min
  CATEGORY: 1800,       // 30 min
};

import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedisClient } from "../config/redis.config";

// Shared Redis-backed store so limits hold across instances. Falls back to the
// in-memory store when REDIS_URL is not configured.
function makeStore() {
  const client = getRedisClient();
  if (!client) return undefined;
  return new RedisStore({
    // ioredis: forward the raw command.
    sendCommand: (...args: string[]) => (client as any).call(...args),
  });
}

function makeLimiter(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: makeStore(),
    message: { status: "error", message },
    // Disable rate limiting under the test runner — suites fire many requests
    // in quick succession and would otherwise trip the limits.
    skip: () => process.env.NODE_ENV === "test",
  });
}

// Sensitive auth endpoints — brute-force protection (per IP).
export const authLimiter = makeLimiter(
  15 * 60 * 1000,
  15,
  "Too many attempts. Please try again in a few minutes.",
);

// Checkout — guards against runaway/duplicate order attempts (per IP).
export const checkoutLimiter = makeLimiter(
  60 * 1000,
  12,
  "Too many checkout attempts. Please slow down.",
);

// Public writes (reviews, catalog requests).
export const writeLimiter = makeLimiter(
  60 * 1000,
  20,
  "Too many requests. Please slow down.",
);

// ── Per-account failed-login lockout (simple, non-progressive) ──────────────
// Independent of the IP limiter above: locks a specific account after too many
// wrong passwords, regardless of source IP. No-ops if Redis is unavailable.
const LOGIN_MAX_FAILS = 8;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const failKey = (email: string) => `login:fail:${email.toLowerCase()}`;

export async function isLoginLocked(email: string): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;
  const n = await client.get(failKey(email));
  return n != null && parseInt(n, 10) >= LOGIN_MAX_FAILS;
}

export async function registerFailedLogin(email: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  const n = await client.incr(failKey(email));
  if (n === 1) await client.expire(failKey(email), LOGIN_WINDOW_SECONDS);
}

export async function clearLoginFailures(email: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  await client.del(failKey(email));
}

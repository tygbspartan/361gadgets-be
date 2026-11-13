import type { Request } from "express";
import rateLimit, {
  ipKeyGenerator,
  type Options,
  type RateLimitInfo,
} from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedisClient } from "../config/redis.config";

// Shared Redis-backed store so limits hold across instances. Falls back to the
// in-memory store when REDIS_URL is not configured.
// Each limiter needs its own key prefix: with the shared default ("rl:") every
// limiter counted against the same per-IP total.
function makeStore(prefix: string) {
  const client = getRedisClient();
  if (!client) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    // ioredis: forward the raw command.
    sendCommand: (...args: string[]) => (client as any).call(...args),
  });
}

function makeLimiter(
  name: string,
  windowMs: number,
  limit: number,
  message: string,
  keyGenerator?: Options["keyGenerator"],
) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: makeStore(name),
    ...(keyGenerator && { keyGenerator }),
    // retryAfter (seconds) lets the client count down / re-enable a button.
    message: (req: Request & { rateLimit?: RateLimitInfo }) => {
      const reset = req.rateLimit?.resetTime?.getTime();
      return {
        status: "error",
        message,
        retryAfter: reset ? Math.max(1, Math.ceil((reset - Date.now()) / 1000)) : undefined,
      };
    },
    // Disable rate limiting under the test runner — suites fire many requests
    // in quick succession and would otherwise trip the limits.
    skip: () => process.env.NODE_ENV === "test",
  });
}

// Sensitive auth endpoints — brute-force protection (per IP).
export const authLimiter = makeLimiter(
  "auth",
  15 * 60 * 1000,
  15,
  "Too many attempts. Please try again in a few minutes.",
);

// Checkout — guards against runaway/duplicate order attempts (per IP).
export const checkoutLimiter = makeLimiter(
  "checkout",
  60 * 1000,
  12,
  "Too many checkout attempts. Please slow down.",
);

// Public writes (reviews, catalog requests).
export const writeLimiter = makeLimiter(
  "write",
  60 * 1000,
  20,
  "Too many requests. Please slow down.",
);

// Discount code checks — per account for logged-in customers (people on a
// shared network don't block each other), per IP for guests. Runs after
// `optionalAuthenticate`. Stops bulk guessing; 5 a minute is plenty for
// someone trying real codes.
export const discountCheckLimiter = makeLimiter(
  "discount",
  60 * 1000,
  5,
  "Too many discount code attempts. Please wait a minute and try again.",
  (req) => {
    const userId = (req as any).jwtPayload?.userId;
    return userId ? `user:${userId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
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

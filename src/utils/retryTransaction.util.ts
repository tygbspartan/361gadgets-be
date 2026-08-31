// Retries a database operation on *transient* failures only — the kind that
// succeed on a second attempt once contention clears:
//   P2028 — "Unable to start a transaction in the given time" (pool exhausted)
//   P2034 — transaction write-conflict / deadlock (serialization)
//
// Business failures (out-of-stock ConflictError), validation, and the
// idempotency-key unique violation (P2002) are NOT transient — they are
// rethrown immediately so the caller handles them as usual.
const TRANSIENT_CODES = new Set(["P2028", "P2034"]);

export async function withTxRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 50,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err: any) {
      const transient = TRANSIENT_CODES.has(err?.code);
      if (!transient || attempt >= retries) throw err;
      attempt++;
      // Small randomized backoff so retrying requests don't all collide again.
      const delay = baseDelayMs * attempt + Math.floor(Math.random() * baseDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

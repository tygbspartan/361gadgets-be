import { BadRequestError } from "./customError.util";

// Postgres INT4 max; larger values would fail in the query instead.
const MAX_INT = 2_147_483_647;

/*
 * Turn a route param / query value into an integer, or throw a 400.
 *
 * parseInt("abc") is NaN, and a NaN id reaches Prisma as an invalid query,
 * which surfaced as a 500. parseInt("12abc") is 12, which silently hits the
 * wrong row. Both are now rejected as bad input.
 */
function parseIntStrict(value: unknown, label: string, min: number): number {
  const text = String(value ?? "").trim();
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > MAX_INT) {
    throw new BadRequestError(`Invalid ${label}`);
  }
  return n;
}

/** A database id (positive integer). */
export const parseId = (value: unknown, label = "ID"): number =>
  parseIntStrict(value, label, 1);

/** A non-negative integer such as a display order, level or rating. */
export const parseIntParam = (value: unknown, label: string): number =>
  parseIntStrict(value, label, 0);

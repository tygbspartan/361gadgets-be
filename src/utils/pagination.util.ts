// Largest page any list endpoint will return. Without a cap, `?limit=100000`
// makes the server load (and serialise) the whole table in one request.
export const MAX_PAGE_SIZE = 100;

const toPositiveInt = (value: unknown, fallback: number): number => {
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
};

// Parse ?page / ?limit from a query string: page ≥ 1, 1 ≤ limit ≤ MAX_PAGE_SIZE.
// Missing or garbage values fall back instead of reaching Prisma as NaN.
export const parsePagination = (page: unknown, limit: unknown, defaultLimit = 20) => {
  const pageNum = toPositiveInt(page, 1);
  const limitNum = Math.min(MAX_PAGE_SIZE, toPositiveInt(limit, defaultLimit));
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

// Just the capped limit, for endpoints that take a limit but no page.
export const parseLimit = (limit: unknown, defaultLimit = 20): number =>
  parsePagination(1, limit, defaultLimit).limitNum;

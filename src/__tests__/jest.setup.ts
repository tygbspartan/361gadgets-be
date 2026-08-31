// Runs before each test file is imported.

// Pin the test environment before anything (dotenv, config) loads. dotenv does
// not override already-set vars, so this sticks — and rate limiters skip on it.
process.env.NODE_ENV = "test";

// Keep test output clean — silence the app's structured logger.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

// Make tests hermetic: never touch a shared Redis. Set it empty (not delete) so
// dotenv — which only skips keys already present — won't restore it from .env.
// config treats "" as null, so getRedisClient() returns null and nothing connects.
process.env.REDIS_URL = "";

// Integration tests must run against a throwaway database, never dev/prod.
// If TEST_DATABASE_URL is provided, point Prisma at it before anything imports
// the client. If it's absent, the integration suites skip themselves.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  // Migrations use the direct (non-pooled) URL; mirror it unless set explicitly.
  process.env.DIRECT_URL =
    process.env.TEST_DIRECT_URL || process.env.TEST_DATABASE_URL;
}

/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  setupFiles: ["<rootDir>/src/__tests__/jest.setup.ts"],
  // Integration tests talk to a real database and spin up the app.
  testTimeout: 30000,
  // The app/Prisma keep handles open after tests; exit cleanly regardless.
  forceExit: true,
  // Don't treat the shared helpers/setup as test files.
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};

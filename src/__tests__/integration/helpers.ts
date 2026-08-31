import request from "supertest";
import app from "../../app";
import prisma from "../../config/database.config";
import { config } from "../../config/env.config";

// Integration tests hit a REAL database + the real Express app via supertest.
// They only run when TEST_DATABASE_URL is set (see jest.setup.ts), so a plain
// `npm test` on a machine without a throwaway DB stays green by skipping them.
export const RUN_INTEGRATION = !!process.env.TEST_DATABASE_URL;
export const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

export { app, prisma, request };

export const api = () => request(app);

let cachedSuperadminToken: string | null = null;

// Logs in as the seeded superadmin (from env). Assumes the test DB has been
// migrated and seeded — see the README section in the test docs.
export async function loginSuperadmin(): Promise<string> {
  if (cachedSuperadminToken) return cachedSuperadminToken;
  const res = await api()
    .post("/api/auth/login")
    .send({ email: config.adminEmail, password: config.adminPassword });
  if (res.status !== 200 || !res.body?.data?.token) {
    throw new Error(
      `superadmin login failed (${res.status}): ${JSON.stringify(res.body)}`,
    );
  }
  const token = res.body.data.token as string;
  cachedSuperadminToken = token;
  return token;
}

// A short unique tag so parallel/repeat runs never collide.
export const tag = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

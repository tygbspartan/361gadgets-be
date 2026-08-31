import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across hot-reloads / imports. Without this guard,
// nodemon + ts-node can spawn a new client (and a new connection pool) on every
// reload, exhausting the database's connection limit ("Timed out fetching a new
// connection from the connection pool").
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prisma =
  globalForPrisma.prisma ??
  (() => {
    const client = new PrismaClient({
      log: [{ emit: "event", level: "query" }],
    });

    // Only surface slow queries — logging every query is too noisy.
    client.$on("query", (e) => {
      if (e.duration > 200) {
        console.warn(`[DB SLOW] ${e.duration}ms → ${e.query.substring(0, 120)}`);
      }
    });

    return client;
  })();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export const testDatabaseConnection = async (): Promise<boolean> => {
  try {
    await prisma.$connect();
    console.log("✅ Database connected successfully");
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    return false;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};

// Cheap round-trip used by the readiness probe. Throws if the DB is unreachable.
export const pingDatabase = async (): Promise<void> => {
  await prisma.$queryRaw`SELECT 1`;
};

export default prisma;

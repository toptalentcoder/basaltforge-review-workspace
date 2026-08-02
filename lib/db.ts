import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma runs engine-less here (driverAdapters + queryCompiler, see
// schema.prisma): connections go through the pure-JS `pg` driver via this
// adapter, so there is no platform-specific native engine binary involved.
function makeClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// Singleton. In Next.js development, module hot-reloading would otherwise
// create a new client (and connection pool) on every reload; caching the
// instance on globalThis prevents connection exhaustion. In production a
// module is evaluated once, so the global cache is a no-op.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

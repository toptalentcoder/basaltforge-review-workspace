import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Kept in step with tests/test-db.ts (which global setup uses). Override with
// TEST_DATABASE_URL if your Postgres connection differs.
const testUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://workspace:workspace@localhost:5433/workspace_test";

export default defineConfig({
  // Resolve the app's "@/*" path alias to the project root.
  resolve: {
    alias: { "@": resolve(process.cwd()) },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Point the app's Prisma client at the isolated test database, and give
    // the session signer a deterministic secret for the run.
    env: {
      DATABASE_URL: testUrl,
      SESSION_SECRET: "test-session-secret",
      NODE_ENV: "test",
    },
    // One shared database → run files serially for determinism.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});

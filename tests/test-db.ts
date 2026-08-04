// Connection strings for the isolated test database. Defaults match both the
// local dev cluster and the docker-compose Postgres (workspace:workspace@5433);
// override with TEST_DATABASE_URL / TEST_ADMIN_DATABASE_URL if yours differs.
export const TEST_DB_NAME = "workspace_test";

export const testUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://workspace:workspace@localhost:5433/workspace_test";

// The maintenance connection used only to DROP/CREATE the test database.
export const adminUrl =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgresql://workspace:workspace@localhost:5433/postgres";

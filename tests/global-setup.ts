import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { TEST_DB_NAME, adminUrl, testUrl } from "./test-db";

// Runs once before the whole suite: drop and recreate a clean test database,
// then apply the project's migrations to it. The schema is applied by executing
// the committed migration SQL over the pg driver (not `prisma migrate`), so the
// same setup works whether or not Prisma's native engine runs on this machine.
export default async function setup() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  const migrationsDir = join(process.cwd(), "prisma", "migrations");
  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const db = new Client({ connectionString: testUrl });
  await db.connect();
  for (const name of migrations) {
    const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
    await db.query(sql);
  }
  await db.end();
}

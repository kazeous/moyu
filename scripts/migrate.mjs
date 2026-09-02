import process from "node:process";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { parseEnv } from "../src/server/env.ts";
import {
  checkMigrationReadiness,
  migrationsFolder,
  readGeneratedMigrations,
} from "../src/server/db/migration-readiness.ts";

let database;
try {
  const env = parseEnv(process.env);
  readGeneratedMigrations();
  database = postgres(env.databaseUrl, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
  await migrate(drizzle(database), { migrationsFolder });
  await checkMigrationReadiness(database);
  process.stdout.write("Database migrations are ready.\n");
} catch {
  process.stderr.write(
    "Migration failed. Check environment, database access and migration history.\n",
  );
  process.exitCode = 1;
} finally {
  await database?.end({ timeout: 5 });
}

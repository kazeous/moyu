import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { parseEnv } from "@/server/env";

import { databaseSchema } from "./schema";

let database: ReturnType<typeof drizzle<typeof databaseSchema>> | undefined;

export function getDatabaseClient(): ReturnType<
  typeof drizzle<typeof databaseSchema>
> {
  if (!database) {
    const { databaseUrl } = parseEnv(process.env);
    database = drizzle(postgres(databaseUrl, { max: 10 }), {
      schema: databaseSchema,
    });
  }

  return database;
}

export async function checkDatabaseConnection(): Promise<void> {
  await getDatabaseClient().execute(sql`SELECT 1`);
}

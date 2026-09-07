import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type postgres from "postgres";
import { z } from "zod";

export const migrationsFolder = join(process.cwd(), "src/server/db/migrations");

const journalSchema = z
  .object({
    version: z.string(),
    dialect: z.literal("postgresql"),
    entries: z
      .array(
        z
          .object({
            idx: z.number().int().nonnegative(),
            version: z.string(),
            when: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            tag: z.string().regex(/^\d{4}_[a-zA-Z0-9_]+$/),
            breakpoints: z.boolean(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const appliedMigrationsSchema = z.array(
  z
    .object({
      hash: z.string(),
      created_at: z.coerce
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
);

export type GeneratedMigration = Readonly<{ hash: string; createdAt: number }>;

export function readGeneratedMigrations(
  folder = migrationsFolder,
): GeneratedMigration[] {
  try {
    const journal = journalSchema.parse(
      JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")),
    );
    return journal.entries.map((entry, index) => {
      if (
        entry.idx !== index ||
        (index > 0 && entry.when <= journal.entries[index - 1].when)
      ) {
        throw new Error("Invalid migration order");
      }
      const sql = readFileSync(join(folder, `${entry.tag}.sql`), "utf8");
      if (!sql.trim()) throw new Error("Empty migration");
      return {
        hash: createHash("sha256").update(sql).digest("hex"),
        createdAt: entry.when,
      };
    });
  } catch {
    throw new Error("Generated migrations are not ready");
  }
}

export async function checkMigrationReadiness(
  database: postgres.Sql,
  generated: readonly GeneratedMigration[] = readGeneratedMigrations(),
): Promise<void> {
  try {
    const applied = appliedMigrationsSchema.parse(
      await database`
      SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at
    `,
    );
    if (
      generated.length === 0 ||
      applied.length !== generated.length ||
      generated.some(
        (migration, index) =>
          migration.hash !== applied[index].hash ||
          migration.createdAt !== applied[index].created_at,
      )
    )
      throw new Error("Migration ledger mismatch");
  } catch {
    throw new Error("Database migrations are not ready");
  }
}

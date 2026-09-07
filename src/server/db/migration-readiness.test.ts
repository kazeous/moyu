import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkMigrationReadiness,
  readGeneratedMigrations,
} from "./migration-readiness";
import { getHealthStatus } from "../health";

const admin = postgres(
  process.env.DATABASE_URL ?? "postgresql://moyu:moyu@localhost:5432/moyu",
  { max: 1, onnotice: () => undefined },
);
const databaseName = `readiness_${randomUUID().replaceAll("-", "")}`;
let database: ReturnType<typeof postgres>;

beforeAll(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  const url = new URL(
    process.env.DATABASE_URL ?? "postgresql://moyu:moyu@localhost:5432/moyu",
  );
  url.pathname = `/${databaseName}`;
  database = postgres(url.toString(), { max: 1 });
});

afterAll(async () => {
  await database?.end();
  await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`;
  await admin.end();
});

describe("migration readiness", () => {
  it("fails for absent, outdated or altered migrations and accepts the complete matching ledger", async () => {
    const generated = readGeneratedMigrations();
    expect(generated).toHaveLength(1);
    const check = () => checkMigrationReadiness(database);
    await expect(check()).rejects.toThrow();
    await expect(
      getHealthStatus(async () => {
        await database`SELECT 1`;
      }, check),
    ).resolves.toEqual({
      status: "degraded",
      checks: { database: "ok", migrations: "failed" },
    });
    await database`CREATE SCHEMA drizzle`;
    await database`CREATE TABLE drizzle.__drizzle_migrations (hash text NOT NULL, created_at bigint NOT NULL)`;
    await expect(check()).rejects.toThrow("Database migrations are not ready");
    await database`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('wrong', ${generated[0].createdAt})`;
    await expect(check()).rejects.toThrow("Database migrations are not ready");
    await database`UPDATE drizzle.__drizzle_migrations SET hash = ${generated[0].hash}`;
    await expect(check()).resolves.toBeUndefined();
    await database`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('future', ${generated[0].createdAt + 1})`;
    await expect(check()).rejects.toThrow("Database migrations are not ready");
  });

  it("fails when generated SQL is missing, blank or its journal is empty", () => {
    const folder = mkdtempSync(join(tmpdir(), "moyu-migrations-"));
    try {
      mkdirSync(join(folder, "meta"));
      copyFileSync(
        "src/server/db/migrations/meta/_journal.json",
        join(folder, "meta/_journal.json"),
      );
      expect(() => readGeneratedMigrations(folder)).toThrow(
        "Generated migrations are not ready",
      );
      writeFileSync(join(folder, "0000_cheerful_tomas.sql"), "  ");
      expect(() => readGeneratedMigrations(folder)).toThrow(
        "Generated migrations are not ready",
      );
      writeFileSync(
        join(folder, "meta/_journal.json"),
        JSON.stringify({ version: "7", dialect: "postgresql", entries: [] }),
      );
      expect(() => readGeneratedMigrations(folder)).toThrow(
        "Generated migrations are not ready",
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL, URL } from "node:url";
import postgres from "postgres";
import { z } from "zod";
import * as metadataContracts from "../src/server/metadata-contract.ts";
import { parseEnv } from "../src/server/env.ts";
import {
  checkMigrationReadiness,
  readGeneratedMigrations,
} from "../src/server/db/migration-readiness.ts";

const forbiddenKeys = new Set([
  "dialogue",
  "translation",
  "image",
  "ocrText",
  "analysis",
  "tokenization",
  "lookupResults",
  "selectionHistory",
]);

function assertAllowedKey(key) {
  if (forbiddenKeys.has(key))
    throw new Error(`Forbidden review-content key: ${key}`);
}

/** @param {Record<string, unknown>} exports */
export function assertMetadataContracts(exports = metadataContracts) {
  const keys = new Set();
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.properties) {
      for (const key of Object.keys(node.properties)) {
        assertAllowedKey(key);
        keys.add(key);
      }
    }
    for (const value of Object.values(node)) visit(value);
  }
  const schemas = Object.values(exports).filter(
    (value) => value instanceof z.ZodType,
  );
  if (!schemas.length)
    throw new Error("No exported metadata DTO schemas found");
  for (const schema of schemas)
    visit(z.toJSONSchema(schema, { io: "input", unrepresentable: "throw" }));
  return [...keys].sort();
}

const healthyResponseSchema = z
  .object({
    status: z.literal("ok"),
    checks: z
      .object({ database: z.literal("ok"), migrations: z.literal("ok") })
      .strict(),
  })
  .strict();

export async function checkHealthEndpoint(url) {
  try {
    const response = await globalThis.fetch(z.url().parse(url), {
      signal: globalThis.AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (
      response.status !== 200 ||
      response.headers.get("cache-control") !== "no-store"
    )
      throw new Error("Not ready");
    healthyResponseSchema.parse(await response.json());
  } catch {
    throw new Error("Health endpoint is not ready");
  }
}

/** @param {{ metadataKeys?: string[], env?: NodeJS.ProcessEnv }} options */
export async function runFoundationVerification({
  metadataKeys = [],
  env = process.env,
} = {}) {
  assertMetadataContracts();
  for (const key of metadataKeys) assertAllowedKey(key);
  let parsed;
  try {
    parsed = parseEnv({ ...env, NODE_ENV: "production" });
  } catch {
    throw new Error(
      "Production environment is invalid; check HTTPS origin, database, auth secret and SMTP settings",
    );
  }
  process.stdout.write(
    "Metadata DTO privacy and production environment contract passed (HTTPS/auth/SMTP configuration).\n",
  );
  const generated = readGeneratedMigrations();
  const database = postgres(parsed.databaseUrl, {
    max: 1,
    connect_timeout: 5,
    connection: { statement_timeout: 10_000 },
  });
  try {
    await checkMigrationReadiness(database, generated);
  } finally {
    await database.end({ timeout: 5 });
  }
  process.stdout.write("Generated and applied migrations match.\n");
  await checkHealthEndpoint(
    env.FOUNDATION_HEALTH_URL ??
      new URL("/api/health", parsed.appOrigin).toString(),
  );
  process.stdout.write("Live health endpoint passed.\n");
  const build = spawnSync(
    "docker",
    ["build", "--platform", "linux/arm64", "-t", "moyu:foundation", "."],
    { stdio: "inherit" },
  );
  if (build.error || build.status !== 0)
    throw new Error("ARM Docker build failed");
  const inspect = spawnSync(
    "docker",
    [
      "image",
      "inspect",
      "moyu:foundation",
      "--format",
      "{{.Os}}/{{.Architecture}}",
    ],
    { encoding: "utf8" },
  );
  if (
    inspect.error ||
    inspect.status !== 0 ||
    inspect.stdout.trim() !== "linux/arm64"
  )
    throw new Error("Docker image is not linux/arm64");
  process.stdout.write(
    "Docker build and actual linux/arm64 image architecture passed.\n",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runFoundationVerification();
  } catch (error) {
    process.stderr.write(
      `Foundation verification failed: ${error instanceof Error ? error.message : "Unknown verification error"}\n`,
    );
    process.exitCode = 1;
  }
}

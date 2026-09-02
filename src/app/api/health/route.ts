import postgres from "postgres";

import { parseEnv } from "@/server/env";
import { getHealthStatus } from "@/server/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function checkDatabase(): Promise<void> {
  const { databaseUrl } = parseEnv(process.env);
  const sql = postgres(databaseUrl, { connect_timeout: 5, max: 1 });

  try {
    await sql`SELECT 1`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function GET(): Promise<Response> {
  const health = await getHealthStatus(checkDatabase);

  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

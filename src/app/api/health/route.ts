import { checkDatabaseConnection } from "@/server/db/client";
import { getHealthStatus } from "@/server/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const health = await getHealthStatus(checkDatabaseConnection);

  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

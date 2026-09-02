export type HealthStatus = Readonly<{
  status: "ok" | "degraded";
  checks: Readonly<{
    database: "ok" | "failed";
  }>;
}>;

export async function getHealthStatus(
  checkDatabase: () => Promise<void>,
): Promise<HealthStatus> {
  try {
    await checkDatabase();
    return { status: "ok", checks: { database: "ok" } };
  } catch {
    return { status: "degraded", checks: { database: "failed" } };
  }
}

export type HealthStatus = Readonly<{
  status: "ok" | "degraded";
  checks: Readonly<{
    database: "ok" | "failed";
    migrations: "ok" | "failed" | "unavailable";
  }>;
}>;

export async function getHealthStatus(
  checkDatabase: () => Promise<void>,
  checkMigrations: () => Promise<void>,
): Promise<HealthStatus> {
  try {
    await checkDatabase();
  } catch {
    return {
      status: "degraded",
      checks: { database: "failed", migrations: "unavailable" },
    };
  }
  try {
    await checkMigrations();
    return { status: "ok", checks: { database: "ok", migrations: "ok" } };
  } catch {
    return {
      status: "degraded",
      checks: { database: "ok", migrations: "failed" },
    };
  }
}

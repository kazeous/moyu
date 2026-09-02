import { describe, expect, it } from "vitest";
import { getHealthStatus } from "./health";

describe("getHealthStatus", () => {
  it("reports an available database as healthy", async () => {
    await expect(
      getHealthStatus(
        async () => undefined,
        async () => undefined,
      ),
    ).resolves.toEqual({
      status: "ok",
      checks: { database: "ok", migrations: "ok" },
    });
  });

  it("reports a failed database without exposing the failure", async () => {
    await expect(
      getHealthStatus(
        async () => {
          throw new Error("postgresql://user:secret@db.internal/moyu");
        },
        async () => undefined,
      ),
    ).resolves.toEqual({
      status: "degraded",
      checks: { database: "failed", migrations: "unavailable" },
    });
  });

  it("does not expose a migration error", async () => {
    await expect(
      getHealthStatus(
        async () => undefined,
        async () => {
          throw new Error("internal migration SQL and credentials");
        },
      ),
    ).resolves.toEqual({
      status: "degraded",
      checks: { database: "ok", migrations: "failed" },
    });
  });
});

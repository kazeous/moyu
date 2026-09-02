import { describe, expect, it } from "vitest";
import { getHealthStatus } from "./health";

describe("getHealthStatus", () => {
  it("reports an available database as healthy", async () => {
    await expect(getHealthStatus(async () => undefined)).resolves.toEqual({
      status: "ok",
      checks: { database: "ok" },
    });
  });

  it("reports a failed database without exposing the failure", async () => {
    await expect(
      getHealthStatus(async () => {
        throw new Error("postgresql://user:secret@db.internal/moyu");
      }),
    ).resolves.toEqual({
      status: "degraded",
      checks: { database: "failed" },
    });
  });
});

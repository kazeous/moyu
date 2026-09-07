import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as metadataContracts from "../src/server/metadata-contract";
import {
  assertMetadataContracts,
  checkHealthEndpoint,
  runFoundationVerification,
} from "./verify-foundation.mjs";

describe("foundation verification", () => {
  it("fails when a forbidden server DTO key is introduced", async () => {
    await expect(
      runFoundationVerification({ metadataKeys: ["sourcePhrase", "ocrText"] }),
    ).rejects.toThrow("Forbidden review-content key: ocrText");
  });

  it("inspects the actual exported contracts including nested gloss keys", () => {
    expect(assertMetadataContracts()).toEqual(
      expect.arrayContaining([
        "sourcePhrase",
        "glosses",
        "language",
        "text",
        "workTagIds",
        "name",
        "aliases",
        "theme",
        "interfaceLanguage",
      ]),
    );
  });

  it.each([
    "dialogue",
    "translation",
    "image",
    "ocrText",
    "analysis",
    "tokenization",
    "lookupResults",
    "selectionHistory",
  ])("rejects nested %s keys inside optional array/union DTOs", (key) => {
    expect(() =>
      assertMetadataContracts({
        ...metadataContracts,
        regressionSchema: z.object({
          entries: z
            .array(
              z.union([
                z.object({ safe: z.string() }),
                z.object({ [key]: z.string().optional() }),
              ]),
            )
            .optional(),
        }),
      }),
    ).toThrow(`Forbidden review-content key: ${key}`);
  });

  it.each([
    {
      status: 200,
      body: { status: "ok", checks: { database: "ok", migrations: "ok" } },
      cache: "no-store",
      healthy: true,
    },
    {
      status: 503,
      body: {
        status: "degraded",
        checks: { database: "ok", migrations: "failed" },
      },
      cache: "no-store",
      healthy: false,
    },
    {
      status: 200,
      body: { status: "ok", checks: { database: "ok" } },
      cache: "no-store",
      healthy: false,
    },
    {
      status: 200,
      body: {
        status: "ok",
        checks: { database: "ok", migrations: "ok" },
        secret: "must-not-be-accepted",
      },
      cache: "no-store",
      healthy: false,
    },
    {
      status: 200,
      body: { status: "ok", checks: { database: "ok", migrations: "ok" } },
      cache: "public, max-age=60",
      healthy: false,
    },
  ])(
    "checks the real HTTP health contract: %j",
    async ({ status, body, cache, healthy }) => {
      const server = createServer((_request, response) => {
        response.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": cache,
        });
        response.end(JSON.stringify(body));
      }).listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing server address");
      try {
        const result = checkHealthEndpoint(
          `http://127.0.0.1:${address.port}/api/health`,
        );
        if (healthy) await expect(result).resolves.toBeUndefined();
        else
          await expect(result).rejects.toThrow("Health endpoint is not ready");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});

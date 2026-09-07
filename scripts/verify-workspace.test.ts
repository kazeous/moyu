import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertMetadataContracts } from "./verify-foundation.mjs";
import { inspectWorkspaceBoundary } from "./verify-workspace.mjs";

describe("workspace deployment boundary", () => {
  it.each([
    "fileName",
    "fileBytes",
    "subtitleEncoding",
    "subtitleFormat",
    "subtitleCues",
    "cueTimings",
    "speakerNames",
    "alignmentDraft",
    "subtitleArtifactId",
    "subtitleImportId",
  ])("rejects subtitle-derived server key %s", (key) => {
    expect(() =>
      inspectWorkspaceBoundary({
        apiSources: [
          {
            path: "src/app/api/subtitles/route.ts",
            text: `const body = z.object({ ${key}: z.string() });`,
          },
        ],
      }),
    ).toThrow(
      `Server/API boundary introduces forbidden review-content key ${key}`,
    );
    expect(() =>
      assertMetadataContracts({
        settingsSchema: z.object({
          preferences: z.array(z.object({ [key]: z.string() })),
        }),
      }),
    ).toThrow(`Forbidden review-content key: ${key}`);
  });

  it("rejects a network primitive inside a subtitle worker", () => {
    expect(() =>
      inspectWorkspaceBoundary({
        clientSources: [
          {
            path: "src/client/workspace/subtitles/subtitle-worker.ts",
            text: 'self.fetch("https://example.test")',
          },
        ],
      }),
    ).toThrow("Browser workspace uses network primitive fetch");
  });

  it.each(["serverSources", "apiSources", "appSources"] as const)(
    "rejects subtitle imports at the %s boundary",
    (boundary) => {
      expect(() =>
        inspectWorkspaceBoundary({
          [boundary]: [
            {
              path: "src/server/subtitle-leak.ts",
              text: `'use server';\nimport { subtitleCueSchema } from "@/client/workspace/subtitles/model";`,
            },
          ],
        }),
      ).toThrow("Server code imports browser workspace data");
    },
  );

  it.each([
    "const { subtitleCues: cues } = input;",
    'const value = input["fileBytes"];',
    "const value = input.alignmentDraft;",
  ])("rejects subtitle field access inside server actions: %s", (text) => {
    expect(() =>
      inspectWorkspaceBoundary({
        appSources: [
          {
            path: "src/app/actions/subtitles.ts",
            text: `'use server';\n${text}`,
          },
        ],
      }),
    ).toThrow("Server/API boundary introduces forbidden review-content key");
  });

  it("accepts browser-only workspace code without network primitives", () => {
    expect(
      inspectWorkspaceBoundary({
        clientSources: [
          {
            path: "src/client/workspace/session-store.ts",
            text: 'import { reviewSessionSchema } from "./model";\nindexedDB.open("moyu-local-review");',
          },
        ],
        serverSources: [
          {
            path: "src/server/metadata-contract.ts",
            text: 'import { z } from "zod";\nexport const settings = z.object({ locale: z.string() });',
          },
        ],
        apiSources: [],
      }),
    ).toEqual({ apiFiles: 0, appFiles: 0, clientFiles: 1, serverFiles: 1 });
  });

  it("rejects server imports of browser-only workspace modules", () => {
    expect(() =>
      inspectWorkspaceBoundary({
        serverSources: [
          {
            path: "src/server/leak.ts",
            text: 'import { reviewSessionSchema } from "@/client/workspace/model";',
          },
        ],
      }),
    ).toThrow("Server code imports browser workspace data: src/server/leak.ts");
  });

  it("rejects client workspace imports of server modules", () => {
    expect(() =>
      inspectWorkspaceBoundary({
        clientSources: [
          {
            path: "src/client/workspace/leak.ts",
            text: 'export { database } from "@/server/db/client";',
          },
        ],
      }),
    ).toThrow(
      "Browser workspace imports server code: src/client/workspace/leak.ts",
    );
  });

  it("rejects transitive imports through unchecked client helpers", () => {
    expect(() =>
      inspectWorkspaceBoundary({
        clientSources: [
          {
            path: "src/client/workspace/leak.ts",
            text: 'import { send } from "@/client/network";\nsend();',
          },
        ],
      }),
    ).toThrow(
      "Browser workspace imports unchecked client module @/client/network: src/client/workspace/leak.ts",
    );
  });

  it.each([
    ['fetch("/api/review", { method: "POST" })', "fetch"],
    ['navigator.sendBeacon("/events", payload)', "sendBeacon"],
    ['new EventSource("/events")', "EventSource"],
    ['new WebSocket("wss://example.test")', "WebSocket"],
    ["new XMLHttpRequest()", "XMLHttpRequest"],
    ['window.fetch("/api/review")', "fetch"],
    ['new globalThis.WebSocket("wss://example.test")', "WebSocket"],
  ])("rejects the %s network primitive", (text, primitive) => {
    expect(() =>
      inspectWorkspaceBoundary({
        clientSources: [{ path: "src/client/workspace/leak.ts", text }],
      }),
    ).toThrow(
      `Browser workspace uses network primitive ${primitive}: src/client/workspace/leak.ts`,
    );
  });

  it("rejects forbidden keys in a server action", () => {
    expect(() =>
      inspectWorkspaceBoundary({
        appSources: [
          {
            path: "src/app/actions/review.ts",
            text: `'use server';\nexport async function save(input: { dialogue: string }) { return input; }`,
          },
        ],
      }),
    ).toThrow(
      "Server/API boundary introduces forbidden review-content key dialogue: src/app/actions/review.ts",
    );
  });

  it.each([
    "const value = body.dialogue;",
    'const value = body["dialogue"];',
    "const { dialogue } = body;",
  ])("rejects realistic API key access: %s", (text) => {
    expect(() =>
      inspectWorkspaceBoundary({
        apiSources: [{ path: "src/app/api/review/route.ts", text }],
      }),
    ).toThrow(
      "Server/API boundary introduces forbidden review-content key dialogue: src/app/api/review/route.ts",
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
  ])("rejects the %s key in an API boundary", (key) => {
    expect(() =>
      inspectWorkspaceBoundary({
        apiSources: [
          {
            path: "src/app/api/review/route.ts",
            text: `const body = z.object({ ${key}: z.string() });`,
          },
        ],
      }),
    ).toThrow(
      `Server/API boundary introduces forbidden review-content key ${key}: src/app/api/review/route.ts`,
    );
  });

  it("does not treat comments or display copy as executable network access", () => {
    expect(() =>
      inspectWorkspaceBoundary({
        clientSources: [
          {
            path: "src/client/workspace/copy.ts",
            text: '// fetch("/api/review")\nexport const copy = "No fetch is used";',
          },
        ],
      }),
    ).not.toThrow();
  });
});

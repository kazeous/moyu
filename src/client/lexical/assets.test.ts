import { webcrypto } from "node:crypto";
import { gzipSync } from "node:zlib";
import { IDBFactory } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { createAssetStore, loadDictionaries, verifyPack } from "./assets";
import type { DictionarySource } from "./contracts";

const bytes = Uint8Array.from(
  gzipSync(
    JSON.stringify({
      version: 1,
      sourceId: "test",
      entries: [
        {
          id: "cat",
          headwords: ["猫"],
          readings: [],
          partsOfSpeech: [],
          senses: [{ language: "en", text: "cat" }],
        },
      ],
    }),
  ),
).buffer;
const sha256 = Buffer.from(
  await webcrypto.subtle.digest("SHA-256", bytes),
).toString("hex");
const source: DictionarySource = {
  id: "test",
  name: "Test",
  language: "ja",
  glossLanguages: ["en"],
  version: "1",
  sourceUrl: "https://example.test/data",
  license: "test",
  licenseUrl: "https://example.test/license",
  attribution: "Test source",
  noticeUrl: "/lexical/notice.txt",
  updatePolicy: "manual",
  changes: "normalized",
  url: "/lexical/test-1.json.gz",
  bytes: bytes.byteLength,
  sha256,
  entryCount: 1,
};

it("verifies exact hash, byte count, source and entries before using a dictionary", async () => {
  await expect(verifyPack(bytes, source)).resolves.toMatchObject({
    sourceId: "test",
  });
  await expect(
    verifyPack(bytes, { ...source, sha256: "0".repeat(64) }),
  ).rejects.toThrow();
  await expect(verifyPack(bytes, { ...source, id: "wrong" })).rejects.toThrow();
  await expect(
    verifyPack(bytes, { ...source, entryCount: 2 }),
  ).rejects.toThrow();
});

it("downloads only constant registered paths, caches verified packs and works offline", async () => {
  const store = createAssetStore(new IDBFactory());
  const fetcher = vi.fn(async (url: string) =>
    url === "/lexical/manifest.json"
      ? Response.json({ version: 1, sources: [source] })
      : new Response(bytes),
  );
  const installed = await loadDictionaries("ja", true, store, fetcher);
  expect(installed.packs).toHaveLength(1);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/lexical/manifest.json",
    source.url,
  ]);
  const offline = await loadDictionaries("ja", false, store, async () => {
    throw new Error("offline");
  });
  expect(offline.packs).toHaveLength(1);
  expect(offline.unavailableIds).toEqual([]);
});

it("does not download packs until requested and recovers from a corrupted cache", async () => {
  const store = createAssetStore(new IDBFactory());
  const fetcher = vi.fn(async (url: string) =>
    url === "/lexical/manifest.json"
      ? Response.json({ version: 1, sources: [source] })
      : new Response(bytes),
  );
  expect(
    (await loadDictionaries("ja", false, store, fetcher)).unavailableIds,
  ).toEqual(["test"]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await store.put(source.sha256, new ArrayBuffer(2));
  expect(
    (await loadDictionaries("ja", true, store, fetcher)).packs,
  ).toHaveLength(1);
});

it("reports cache failures while retaining a usable download in memory", async () => {
  const store = {
    get: async () => {
      throw new Error("denied");
    },
    put: async () => {
      throw new Error("denied");
    },
  };
  const fetcher = async (url: string) =>
    url === "/lexical/manifest.json"
      ? Response.json({ version: 1, sources: [source] })
      : new Response(bytes);
  const result = await loadDictionaries("ja", true, store, fetcher);
  expect(result.cacheAvailable).toBe(false);
  expect(result.packs).toHaveLength(1);
});

it("keeps installed dictionaries usable when an update has not been downloaded", async () => {
  const store = createAssetStore(new IDBFactory());
  await loadDictionaries("ja", true, store, async (url) =>
    url === "/lexical/manifest.json"
      ? Response.json({ version: 1, sources: [source] })
      : new Response(bytes),
  );
  const newer = {
    ...source,
    version: "2",
    sha256: "1".repeat(64),
    url: "/lexical/test-2.json.gz",
  };
  const afterUpdate = await loadDictionaries("ja", false, store, async () =>
    Response.json({ version: 1, sources: [newer] }),
  );
  expect(afterUpdate.packs).toHaveLength(1);
  expect(
    afterUpdate.sources.find((item) => item.id === source.id)?.version,
  ).toBe("1");
  const offline = await loadDictionaries("ja", false, store, async () => {
    throw new Error("offline");
  });
  expect(offline.packs).toHaveLength(1);
});

it("does not switch the installed version if replacement storage fails", async () => {
  const store = createAssetStore(new IDBFactory());
  const oldFetcher = async (url: string) =>
    url === "/lexical/manifest.json"
      ? Response.json({ version: 1, sources: [source] })
      : new Response(bytes);
  await loadDictionaries("ja", true, store, oldFetcher);
  const nextBytes = Uint8Array.from(
    gzipSync(
      JSON.stringify({
        version: 1,
        sourceId: "test",
        entries: [
          {
            id: "cat",
            headwords: ["猫"],
            readings: [],
            partsOfSpeech: [],
            senses: [{ language: "en", text: "updated cat" }],
          },
        ],
      }),
    ),
  ).buffer;
  const nextHash = Buffer.from(
    await webcrypto.subtle.digest("SHA-256", nextBytes),
  ).toString("hex");
  const next = {
    ...source,
    version: "2",
    sha256: nextHash,
    bytes: nextBytes.byteLength,
  };
  const quotaStore = {
    get: store.get,
    put: async (key: string, value: unknown) => {
      if (key === nextHash) throw new Error("quota");
      await store.put(key, value);
    },
  };
  const update = await loadDictionaries("ja", true, quotaStore, async (url) =>
    url === "/lexical/manifest.json"
      ? Response.json({ version: 1, sources: [next] })
      : new Response(nextBytes),
  );
  expect(update.cacheAvailable).toBe(false);
  expect(update.packs).toHaveLength(1);
  const offline = await loadDictionaries("ja", false, store, async () => {
    throw new Error("offline");
  });
  expect(offline.packs).toHaveLength(1);
  expect(offline.sources[0].version).toBe("1");
});

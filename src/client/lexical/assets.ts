import {
  dictionaryEntrySchema,
  sourceSchema,
  manifestSchema,
  type DictionaryPack,
  type DictionarySource,
  type Language,
} from "./contracts";
import { z } from "zod";

const packEnvelope = z
  .object({
    version: z.literal(1),
    sourceId: z.string().min(1),
    entries: z.array(z.unknown()),
  })
  .strict();

export type AssetStore = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
};
export function createAssetStore(factory: IDBFactory = indexedDB): AssetStore {
  async function operation(key: string, value?: unknown): Promise<unknown> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("moyu-lexical-assets", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("assets");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error("Dictionary storage unavailable"));
      request.onblocked = () => reject(new Error("Dictionary storage blocked"));
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction(
          "assets",
          value === undefined ? "readonly" : "readwrite",
        );
        const store = transaction.objectStore("assets");
        const request =
          value === undefined ? store.get(key) : store.put(value, key);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = transaction.onabort = () =>
          reject(new Error("Dictionary storage unavailable"));
      });
    } finally {
      database.close();
    }
  }
  return {
    get: (key) => operation(key),
    put: async (key, value) => {
      await operation(key, value);
    },
  };
}

async function readLimited(
  response: Response,
  limit: number,
): Promise<ArrayBuffer> {
  if (!response.ok || !response.body) throw new Error("Dictionary unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error("Dictionary exceeds declared size");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

export async function verifyPack(
  bytes: ArrayBuffer,
  source: DictionarySource,
): Promise<DictionaryPack> {
  if (bytes.byteLength !== source.bytes || bytes.byteLength > 64 * 1024 * 1024)
    throw new Error("Invalid dictionary size");
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (part) => part.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== source.sha256) throw new Error("Invalid dictionary hash");
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const decoded = await readLimited(new Response(stream), 512 * 1024 * 1024);
  const envelope = packEnvelope.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)),
  );
  // Validate each entry without retaining Zod's second full deep copy.
  for (const entry of envelope.entries) {
    if (!dictionaryEntrySchema.safeParse(entry).success)
      throw new Error("Invalid dictionary entry");
  }
  const pack = envelope as DictionaryPack;
  if (pack.sourceId !== source.id || pack.entries.length !== source.entryCount)
    throw new Error("Invalid dictionary identity");
  if (
    pack.entries.some((entry) =>
      entry.senses.some(
        (sense) => !source.glossLanguages.includes(sense.language),
      ),
    )
  )
    throw new Error("Invalid gloss language");
  if (
    new Set(pack.entries.map((entry) => entry.id)).size !== pack.entries.length
  )
    throw new Error("Duplicate dictionary entry");
  return pack;
}

type AssetFetch = (url: string, init?: RequestInit) => Promise<Response>;
const requestOptions: RequestInit = {
  credentials: "omit",
  referrerPolicy: "no-referrer",
  cache: "no-cache",
};
export async function loadDictionaries(
  language: Language,
  download: boolean,
  store: AssetStore,
  fetcher: AssetFetch = fetch,
) {
  let cacheAvailable = true;
  const read = async (key: string) => {
    try {
      return await store.get(key);
    } catch {
      cacheAvailable = false;
      return undefined;
    }
  };
  const save = async (key: string, value: unknown) => {
    try {
      await store.put(key, value);
      return true;
    } catch {
      cacheAvailable = false;
      return false;
    }
  };
  let manifest;
  try {
    const response = await fetcher("/lexical/manifest.json", {
      ...requestOptions,
      signal: AbortSignal.timeout(15_000),
    });
    const bytes = await readLimited(response, 1024 * 1024);
    manifest = manifestSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    await save("manifest", manifest);
  } catch {
    manifest = manifestSchema.parse(await read("manifest"));
  }
  const packs: { language: Language; pack: DictionaryPack }[] = [];
  const unavailableIds: string[] = [];
  const updateIds: string[] = [];
  const effectiveSources = [...manifest.sources];
  let downloadBytes = 0;
  for (const source of manifest.sources.filter(
    (item) => item.language === language,
  )) {
    let pack: DictionaryPack | undefined;
    let persisted = false;
    const cached = await read(source.sha256);
    if (cached instanceof ArrayBuffer) {
      try {
        pack = await verifyPack(cached, source);
        persisted = true;
      } catch {
        /* Retry replaces only a verified asset. */
      }
    }
    if (!pack && download) {
      try {
        const response = await fetcher(source.url, {
          ...requestOptions,
          signal: AbortSignal.timeout(120_000),
        });
        const bytes = await readLimited(
          response,
          Math.min(source.bytes, 64 * 1024 * 1024),
        );
        pack = await verifyPack(bytes, source);
        persisted = await save(source.sha256, bytes);
      } catch {
        /* Individual providers remain explicitly unavailable. */
      }
    }
    if (pack && persisted) await save(`installed:${source.id}`, source);
    if (!pack) {
      const installed = sourceSchema.safeParse(
        await read(`installed:${source.id}`),
      );
      if (
        installed.success &&
        installed.data.language === language &&
        installed.data.id === source.id
      ) {
        const previousBytes = await read(installed.data.sha256);
        if (previousBytes instanceof ArrayBuffer) {
          try {
            pack = await verifyPack(previousBytes, installed.data);
            effectiveSources[
              effectiveSources.findIndex((item) => item.id === source.id)
            ] = installed.data;
            updateIds.push(source.id);
          } catch {
            /* Corrupt older packs never become fallback evidence. */
          }
        }
      }
      downloadBytes += source.bytes;
    }
    if (pack) packs.push({ language, pack });
    else unavailableIds.push(source.id);
  }
  return {
    sources: effectiveSources,
    packs,
    unavailableIds,
    updateIds,
    downloadBytes,
    cacheAvailable,
  };
}

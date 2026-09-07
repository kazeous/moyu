import { createAssetStore, loadDictionaries } from "./assets";
import { workerRequestSchema, type WorkerResponse } from "./contracts";
import { analyze, createDictionaryIndex, matchPhrases } from "./engine";

let index = createDictionaryIndex([]);
let loadGeneration = 0;
const respond = (response: WorkerResponse) => self.postMessage(response);

self.addEventListener("message", async (event: MessageEvent<unknown>) => {
  const parsed = workerRequestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const request = parsed.data;
  try {
    if (request.kind === "load") {
      const generation = ++loadGeneration;
      const result = await loadDictionaries(
        request.language,
        request.download,
        createAssetStore(),
      );
      if (generation !== loadGeneration) return;
      index = createDictionaryIndex(result.packs);
      respond({
        kind: "loaded",
        id: request.id,
        sources: result.sources,
        installedIds: result.packs.map(({ pack }) => pack.sourceId),
        unavailableIds: result.unavailableIds,
        updateIds: result.updateIds,
        downloadBytes: result.downloadBytes,
        cacheAvailable: result.cacheAvailable,
      });
    } else {
      respond({
        kind: "analyzed",
        id: request.id,
        analysis: analyze(request.source, request.language, index),
        overlays: matchPhrases(
          request.source,
          request.language,
          request.phrases,
          request.workTagIds,
        ),
      });
    }
  } catch {
    respond({
      kind: "unavailable",
      id: request.id,
      reason: "assets",
      retryable: true,
    });
  }
});

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import type { ReviewSession } from "./model";
import {
  createLocalSessionStore,
  type LocalWorkspaceSnapshot,
} from "./session-store";
import type {
  SubtitleArtifact,
  SubtitleCue,
  SubtitleProcessingFailure,
} from "./subtitles/contracts";
import { createSubtitleImportDraft, keepSourceOnly } from "./subtitles/draft";
import type { PersistedSubtitleImport } from "./subtitles/import-record";

const DATABASE_NAME = "moyu-local-review";
const legacySession = {
  version: 1 as const,
  sourceLanguage: "ja" as const,
  referenceLanguage: "en" as const,
  rawImportText: "  原文  \r\nReference  ",
  lines: [{ id: "line-1", source: "  原文  ", reference: "Reference  " }],
  activeLineId: "line-1",
  evidencePanelWidth: 412,
};
const pasteSession: ReviewSession = {
  version: 2,
  sourceLanguage: "ja",
  referenceLanguage: "en",
  origin: { kind: "paste", rawImportText: legacySession.rawImportText },
  lines: legacySession.lines,
  activeLineId: "line-1",
  evidencePanelWidth: 412,
};
const replacementDecodeFailure: SubtitleProcessingFailure = {
  kind: "processing-error",
  code: "invalid-encoding",
  role: "source",
  retryable: true,
  message: "The file is not valid utf-8.",
};

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

function transactionResult(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), {
      once: true,
    });
    transaction.addEventListener("error", () => reject(transaction.error), {
      once: true,
    });
  });
}

function openDatabase(
  indexedDb: IDBFactory,
  version: number,
  stores: readonly string[],
) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, version);
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
    request.addEventListener(
      "upgradeneeded",
      () => {
        for (const store of stores) {
          if (!request.result.objectStoreNames.contains(store)) {
            request.result.createObjectStore(store);
          }
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
  });
}

async function putRawValue(
  indexedDb: IDBFactory,
  version: number,
  storeName: string,
  key: IDBValidKey,
  value: unknown,
) {
  const database = await openDatabase(indexedDb, version, [
    "sessions",
    ...(version >= 2
      ? ["subtitle-imports", "subtitle-artifacts", "preferences"]
      : []),
  ]);
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value, key);
  await transactionResult(transaction);
  database.close();
}

async function readRawValue<T>(
  indexedDb: IDBFactory,
  storeName: string,
  key: IDBValidKey,
) {
  const database = await openDatabase(indexedDb, 2, [
    "sessions",
    "subtitle-imports",
    "subtitle-artifacts",
    "preferences",
  ]);
  const transaction = database.transaction(storeName, "readonly");
  const completed = transactionResult(transaction);
  const value = await requestResult<T | undefined>(
    transaction.objectStore(storeName).get(key),
  );
  await completed;
  database.close();
  return value;
}

async function readArtifactKeys(indexedDb: IDBFactory) {
  const database = await openDatabase(indexedDb, 2, [
    "sessions",
    "subtitle-imports",
    "subtitle-artifacts",
    "preferences",
  ]);
  const transaction = database.transaction("subtitle-artifacts", "readonly");
  const completed = transactionResult(transaction);
  const keys = await requestResult(
    transaction.objectStore("subtitle-artifacts").getAllKeys(),
  );
  await completed;
  database.close();
  return keys;
}

function artifact(
  id: string,
  role: "source" | "reference",
  contents = id,
): SubtitleArtifact {
  const bytes = new Blob([contents], { type: "application/x-subrip" });
  return {
    id,
    role,
    name: `${id}.srt`,
    size: bytes.size,
    format: "srt",
    requestedEncoding: "utf-8",
    resolvedEncoding: "utf-8",
    bytes,
    status: "decoded",
  };
}

function cue(
  id: string,
  artifactId: string,
  role: "source" | "reference",
): SubtitleCue {
  return {
    id,
    artifactId,
    sourceOrder: 0,
    startMs: 0,
    endMs: 1_000,
    rawPayload: `raw:${role}`,
    visibleText: role,
    warnings: [],
  };
}

function usableDraftFor(sourceArtifactId: string) {
  const draft = createSubtitleImportDraft({
    id: "import-1",
    sourceArtifactId,
    sourceLanguage: "ja",
    referenceLanguage: "en",
    sourceCues: [cue(`${sourceArtifactId}:cue:0`, sourceArtifactId, "source")],
    referenceCues: [],
  });
  return keepSourceOnly(draft, draft.groups[0].id);
}

function importRecord(
  sourceArtifactId: string,
  options: Partial<PersistedSubtitleImport> = {},
): PersistedSubtitleImport {
  return {
    version: 1,
    id: "import-1",
    source: { artifactId: sourceArtifactId, language: "ja" },
    reference: null,
    draft: usableDraftFor(sourceArtifactId),
    failure: null,
    ...options,
  };
}

type LoadResult = Awaited<
  ReturnType<ReturnType<typeof createLocalSessionStore>["load"]>
>;

function availableSnapshot(result: LoadResult) {
  if (result.kind !== "available") {
    throw new Error(`Expected an available snapshot, received ${result.kind}.`);
  }
  return result.snapshot;
}

async function artifactBytes(
  snapshot: LocalWorkspaceSnapshot,
  artifactId: string,
) {
  const stored = snapshot.artifacts.find((item) => item.id === artifactId);
  if (!stored) throw new Error(`Missing artifact ${artifactId}.`);
  return stored.bytes.arrayBuffer();
}

describe("createLocalSessionStore", () => {
  it("upgrades a version-1 database, returns a migrated v2 session, and persists it", async () => {
    const indexedDb = new IDBFactory();
    await putRawValue(indexedDb, 1, "sessions", "active", legacySession);

    const result = await createLocalSessionStore(indexedDb).load();

    expect(result).toMatchObject({
      kind: "available",
      snapshot: { session: { version: 2, origin: { kind: "paste" } } },
    });
    await expect(
      readRawValue<ReviewSession>(indexedDb, "sessions", "active"),
    ).resolves.toEqual(pasteSession);
  });

  it("round-trips raw blobs, draft decisions, and browser preferences", async () => {
    const sourceArtifact = artifact("source", "source", "source bytes");
    const referenceArtifact = artifact(
      "reference",
      "reference",
      "reference bytes",
    );
    const draft = createSubtitleImportDraft({
      id: "import-1",
      sourceArtifactId: sourceArtifact.id,
      referenceArtifactId: referenceArtifact.id,
      sourceLanguage: "ja",
      referenceLanguage: "en",
      sourceCues: [cue("s1", sourceArtifact.id, "source")],
      referenceCues: [cue("r1", referenceArtifact.id, "reference")],
    });
    const importState: PersistedSubtitleImport = {
      version: 1,
      id: "import-1",
      source: { artifactId: sourceArtifact.id, language: "ja" },
      reference: { artifactId: referenceArtifact.id, language: "en" },
      draft,
      failure: null,
    };
    const store = createLocalSessionStore(new IDBFactory());

    await expect(
      store.saveSubtitleImport({
        importState,
        putArtifacts: [sourceArtifact, referenceArtifact],
        deleteArtifactIds: [],
      }),
    ).resolves.toEqual({ kind: "saved" });
    await expect(
      store.savePreferences({ showSpeakerNames: false }),
    ).resolves.toEqual({ kind: "saved" });

    const loaded = await store.load();
    expect(loaded).toMatchObject({
      kind: "available",
      snapshot: {
        subtitleImport: importState,
        preferences: { showSpeakerNames: false },
      },
    });
    const snapshot = availableSnapshot(loaded);
    expect(snapshot.artifacts.map((item) => item.id)).toEqual([
      "source",
      "reference",
    ]);
    expect(await artifactBytes(snapshot, sourceArtifact.id)).toEqual(
      await sourceArtifact.bytes.arrayBuffer(),
    );
  });

  it("persists a failed first attempt without a parsed draft", async () => {
    const indexedDb = new IDBFactory();
    const failedArtifact = {
      ...artifact("attempt-source", "source"),
      resolvedEncoding: null,
      status: "failed" as const,
    };
    const importState: PersistedSubtitleImport = {
      version: 1,
      id: "import-1",
      source: { artifactId: failedArtifact.id, language: "ja" },
      reference: null,
      draft: null,
      failure: replacementDecodeFailure,
    };
    const store = createLocalSessionStore(indexedDb);

    await expect(
      store.saveSubtitleImport({
        importState,
        putArtifacts: [failedArtifact],
        deleteArtifactIds: [],
      }),
    ).resolves.toEqual({ kind: "saved" });
    await expect(store.load()).resolves.toMatchObject({
      kind: "available",
      snapshot: { subtitleImport: importState },
    });
  });

  it("retains both replacement bytes and the prior usable draft after a failure", async () => {
    const indexedDb = new IDBFactory();
    const previousArtifact = artifact("previous-source", "source");
    const replacementArtifact = {
      ...artifact("replacement-source", "source"),
      resolvedEncoding: null,
      status: "failed" as const,
    };
    const importState = importRecord(replacementArtifact.id, {
      draft: usableDraftFor(previousArtifact.id),
      failure: replacementDecodeFailure,
    });
    const store = createLocalSessionStore(indexedDb);

    await expect(
      store.saveSubtitleImport({
        importState,
        putArtifacts: [previousArtifact, replacementArtifact],
        deleteArtifactIds: [],
      }),
    ).resolves.toEqual({ kind: "saved" });
    const loaded = availableSnapshot(await store.load());
    expect(loaded.subtitleImport?.draft?.sourceArtifactId).toBe(
      previousArtifact.id,
    );
    expect(loaded.artifacts.map((item) => item.id)).toEqual([
      replacementArtifact.id,
      previousArtifact.id,
    ]);
  });

  it("deletes explicitly replaced artifacts in the same import transaction", async () => {
    const indexedDb = new IDBFactory();
    const previousArtifact = artifact("previous-source", "source");
    const replacementArtifact = artifact("replacement-source", "source");
    const store = createLocalSessionStore(indexedDb);
    await store.saveSubtitleImport({
      importState: importRecord(previousArtifact.id),
      putArtifacts: [previousArtifact],
      deleteArtifactIds: [],
    });

    await expect(
      store.saveSubtitleImport({
        importState: importRecord(replacementArtifact.id),
        putArtifacts: [replacementArtifact],
        deleteArtifactIds: [previousArtifact.id],
      }),
    ).resolves.toEqual({ kind: "saved" });

    await expect(readArtifactKeys(indexedDb)).resolves.toEqual([
      replacementArtifact.id,
    ]);
  });

  it("aborts an invalid replacement transaction and leaves the prior state intact", async () => {
    const indexedDb = new IDBFactory();
    const previousArtifact = artifact("previous-source", "source");
    const unrelatedArtifact = artifact("unrelated-source", "source");
    const previousImport = importRecord(previousArtifact.id);
    const store = createLocalSessionStore(indexedDb);
    await store.saveSubtitleImport({
      importState: previousImport,
      putArtifacts: [previousArtifact],
      deleteArtifactIds: [],
    });

    await expect(
      store.saveSubtitleImport({
        importState: importRecord("missing-source"),
        putArtifacts: [unrelatedArtifact],
        deleteArtifactIds: [previousArtifact.id],
      }),
    ).resolves.toMatchObject({ kind: "unavailable" });

    const loaded = availableSnapshot(await store.load());
    expect(loaded.subtitleImport).toEqual(previousImport);
    expect(loaded.artifacts.map((item) => item.id)).toEqual([
      previousArtifact.id,
    ]);
    await expect(readArtifactKeys(indexedDb)).resolves.toEqual([
      previousArtifact.id,
    ]);
  });

  it("returns corrupt for a missing referenced artifact", async () => {
    const indexedDb = new IDBFactory();
    await putRawValue(
      indexedDb,
      2,
      "subtitle-imports",
      "current",
      importRecord("missing-source"),
    );

    await expect(createLocalSessionStore(indexedDb).load()).resolves.toEqual({
      kind: "corrupt",
      reason: "The saved local subtitle artifacts cannot be read safely.",
    });
  });

  it("returns corrupt for invalid or future persisted import records", async () => {
    const indexedDb = new IDBFactory();
    await putRawValue(indexedDb, 2, "subtitle-imports", "current", {
      version: 999,
    });

    await expect(createLocalSessionStore(indexedDb).load()).resolves.toEqual({
      kind: "corrupt",
      reason: "The saved local subtitle import cannot be read safely.",
    });
  });

  it("returns corrupt when a subtitle session has no matching persisted import", async () => {
    const indexedDb = new IDBFactory();
    await putRawValue(indexedDb, 2, "sessions", "active", {
      ...pasteSession,
      origin: { kind: "subtitle", importId: "missing-import" },
    });

    await expect(createLocalSessionStore(indexedDb).load()).resolves.toEqual({
      kind: "corrupt",
      reason: "The saved local subtitle import cannot be read safely.",
    });
  });

  it("rejects an artifact whose role disagrees with its selected slot", async () => {
    const indexedDb = new IDBFactory();
    const wrongRoleArtifact = artifact("source", "reference");
    const store = createLocalSessionStore(indexedDb);

    await expect(
      store.saveSubtitleImport({
        importState: importRecord(wrongRoleArtifact.id),
        putArtifacts: [wrongRoleArtifact],
        deleteArtifactIds: [],
      }),
    ).resolves.toMatchObject({ kind: "unavailable" });
    expect(availableSnapshot(await store.load()).subtitleImport).toBeNull();
  });

  it("uses visible speaker names by default when no preference is saved", async () => {
    const result = await createLocalSessionStore(new IDBFactory()).load();
    expect(result).toMatchObject({
      kind: "available",
      snapshot: { preferences: { showSpeakerNames: true } },
    });
  });

  it("clears session, draft, and artifacts in one transaction but keeps preferences", async () => {
    const indexedDb = new IDBFactory();
    const sourceArtifact = artifact("source", "source");
    const store = createLocalSessionStore(indexedDb);
    await store.saveSession(pasteSession);
    await store.saveSubtitleImport({
      importState: importRecord(sourceArtifact.id),
      putArtifacts: [sourceArtifact],
      deleteArtifactIds: [],
    });
    await store.savePreferences({ showSpeakerNames: false });

    await expect(store.clearReviewContent()).resolves.toEqual({
      kind: "saved",
    });
    await expect(store.load()).resolves.toMatchObject({
      kind: "available",
      snapshot: {
        session: null,
        subtitleImport: null,
        artifacts: [],
        preferences: { showSpeakerNames: false },
      },
    });
  });

  it("returns unavailable without modifying data when the clear transaction cannot open", async () => {
    const indexedDb = new IDBFactory();
    const database = await openDatabase(indexedDb, 2, ["sessions"]);
    const transaction = database.transaction("sessions", "readwrite");
    transaction.objectStore("sessions").put(pasteSession, "active");
    await transactionResult(transaction);
    database.close();

    await expect(
      createLocalSessionStore(indexedDb).clearReviewContent(),
    ).resolves.toMatchObject({ kind: "unavailable" });
    await expect(
      readRawValue<ReviewSession>(indexedDb, "sessions", "active"),
    ).resolves.toEqual(pasteSession);
  });

  it("returns explicit unavailable states when IndexedDB is absent", async () => {
    const store = createLocalSessionStore(undefined);
    const sourceArtifact = artifact("source", "source");

    await expect(store.load()).resolves.toMatchObject({ kind: "unavailable" });
    await expect(store.saveSession(pasteSession)).resolves.toMatchObject({
      kind: "unavailable",
    });
    await expect(
      store.saveSubtitleImport({
        importState: importRecord(sourceArtifact.id),
        putArtifacts: [sourceArtifact],
        deleteArtifactIds: [],
      }),
    ).resolves.toMatchObject({ kind: "unavailable" });
    await expect(
      store.savePreferences({ showSpeakerNames: true }),
    ).resolves.toMatchObject({ kind: "unavailable" });
    await expect(store.clearReviewContent()).resolves.toMatchObject({
      kind: "unavailable",
    });
  });

  it("rejects unknown session fields before writing them", async () => {
    const store = createLocalSessionStore(new IDBFactory());
    const unsafeSession = {
      ...pasteSession,
      lines: [
        { ...pasteSession.lines[0], serverId: "must-not-cross-boundaries" },
      ],
    } as unknown as ReviewSession;

    await expect(store.saveSession(unsafeSession)).resolves.toEqual({
      kind: "unavailable",
      reason: "The local review session is incomplete and was not saved.",
    });
  });
});

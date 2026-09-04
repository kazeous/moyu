import { z } from "zod";

import {
  migrateReviewSession,
  reviewSessionSchema,
  type ReviewSession,
} from "./model";
import {
  subtitleArtifactSchema,
  type SubtitleArtifact,
} from "./subtitles/contracts";
import {
  persistedSubtitleImportSchema,
  referencedSubtitleArtifactIds,
  type PersistedSubtitleImport,
} from "./subtitles/import-record";

const DATABASE_NAME = "moyu-local-review";
const DATABASE_VERSION = 2;
const SESSION_STORE = "sessions";
const SUBTITLE_IMPORT_STORE = "subtitle-imports";
const SUBTITLE_ARTIFACT_STORE = "subtitle-artifacts";
const PREFERENCE_STORE = "preferences";
const ACTIVE_SESSION_KEY = "active";
const CURRENT_SUBTITLE_IMPORT_KEY = "current";
const WORKSPACE_PREFERENCE_KEY = "workspace";

export const workspacePreferencesSchema = z
  .object({ showSpeakerNames: z.boolean() })
  .strict();
export type WorkspacePreferences = Readonly<
  z.infer<typeof workspacePreferencesSchema>
>;

export const saveSubtitleImportInputSchema = z
  .object({
    importState: persistedSubtitleImportSchema,
    putArtifacts: z.array(subtitleArtifactSchema),
    deleteArtifactIds: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((input, context) => {
    const putIds = input.putArtifacts.map((artifact) => artifact.id);
    if (new Set(putIds).size !== putIds.length) {
      context.addIssue({
        code: "custom",
        path: ["putArtifacts"],
        message: "Each subtitle artifact can only be written once.",
      });
    }
    if (
      new Set(input.deleteArtifactIds).size !== input.deleteArtifactIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["deleteArtifactIds"],
        message: "Each subtitle artifact can only be deleted once.",
      });
    }
  });
export type SaveSubtitleImportInput = Readonly<{
  importState: PersistedSubtitleImport;
  putArtifacts: readonly SubtitleArtifact[];
  deleteArtifactIds: readonly string[];
}>;

export type LocalWorkspaceSnapshot = Readonly<{
  session: ReviewSession | null;
  subtitleImport: PersistedSubtitleImport | null;
  artifacts: readonly SubtitleArtifact[];
  preferences: WorkspacePreferences;
}>;

export type LocalWorkspaceResult =
  | Readonly<{
      kind: "available";
      snapshot: LocalWorkspaceSnapshot;
      /** Temporary compatibility for the existing paste UI until Task 7. */
      session: ReviewSession | null;
    }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "corrupt"; reason: string }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

export type LocalWorkspaceSaveResult =
  | Readonly<{ kind: "saved" }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

export type LocalSessionResult = LocalWorkspaceResult;
export type LocalSessionSaveResult = LocalWorkspaceSaveResult;

export interface LocalWorkspaceStore {
  clearReviewContent(): Promise<LocalWorkspaceSaveResult>;
  load(): Promise<LocalWorkspaceResult>;
  savePreferences(
    preferences: WorkspacePreferences,
  ): Promise<LocalWorkspaceSaveResult>;
  saveSession(session: ReviewSession): Promise<LocalWorkspaceSaveResult>;
  saveSubtitleImport(
    input: SaveSubtitleImportInput,
  ): Promise<LocalWorkspaceSaveResult>;
}

export interface LocalSessionStore extends LocalWorkspaceStore {
  /** Temporary compatibility for the existing paste UI until Task 7. */
  clear(): Promise<LocalWorkspaceSaveResult>;
  /** Temporary compatibility for the existing paste UI until Task 7. */
  save(session: ReviewSession): Promise<LocalWorkspaceSaveResult>;
}

type RawWorkspaceRecords = Readonly<{
  session: unknown;
  subtitleImport: unknown;
  artifacts: readonly unknown[];
  preferences: unknown;
}>;

function unavailable(reason: string): { kind: "unavailable"; reason: string } {
  return { kind: "unavailable", reason };
}

function corrupt(reason: string): { kind: "corrupt"; reason: string } {
  return { kind: "corrupt", reason };
}

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

function openDatabase(indexedDb: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener(
      "upgradeneeded",
      () => {
        for (const storeName of [
          SESSION_STORE,
          SUBTITLE_IMPORT_STORE,
          SUBTITLE_ARTIFACT_STORE,
          PREFERENCE_STORE,
        ]) {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName);
          }
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

async function readWorkspaceRecords(
  database: IDBDatabase,
): Promise<RawWorkspaceRecords | { kind: "corrupt"; reason: string }> {
  const transaction = database.transaction(
    [
      SESSION_STORE,
      SUBTITLE_IMPORT_STORE,
      SUBTITLE_ARTIFACT_STORE,
      PREFERENCE_STORE,
    ],
    "readonly",
  );
  const completed = transactionResult(transaction);
  const sessionRequest = transaction
    .objectStore(SESSION_STORE)
    .get(ACTIVE_SESSION_KEY);
  const importRequest = transaction
    .objectStore(SUBTITLE_IMPORT_STORE)
    .get(CURRENT_SUBTITLE_IMPORT_KEY);
  const preferenceRequest = transaction
    .objectStore(PREFERENCE_STORE)
    .get(WORKSPACE_PREFERENCE_KEY);
  const [session, subtitleImport, preferences] = await Promise.all([
    requestResult(sessionRequest),
    requestResult(importRequest),
    requestResult(preferenceRequest),
  ]);

  let artifactIds: readonly string[] = [];
  if (subtitleImport !== undefined) {
    const parsedImport =
      persistedSubtitleImportSchema.safeParse(subtitleImport);
    if (!parsedImport.success) {
      await completed;
      return corrupt("The saved local subtitle import cannot be read safely.");
    }
    artifactIds = [...referencedSubtitleArtifactIds(parsedImport.data)];
  }

  const artifactStore = transaction.objectStore(SUBTITLE_ARTIFACT_STORE);
  const artifacts = await Promise.all(
    artifactIds.map((artifactId) =>
      requestResult(artifactStore.get(artifactId)),
    ),
  );
  await completed;
  return { session, subtitleImport, artifacts, preferences };
}

function parseArtifacts(
  artifactIds: readonly string[],
  values: readonly unknown[],
): readonly SubtitleArtifact[] | null {
  const artifacts: SubtitleArtifact[] = [];
  for (const [index, artifactId] of artifactIds.entries()) {
    const parsed = subtitleArtifactSchema.safeParse(values[index]);
    if (!parsed.success || parsed.data.id !== artifactId) return null;
    artifacts.push(parsed.data);
  }
  return artifacts;
}

function hasValidArtifactRelationship(
  importState: PersistedSubtitleImport,
  artifactsById: ReadonlyMap<string, unknown>,
) {
  const expectedRoles = new Map<string, Set<"source" | "reference">>();
  const addExpectedRole = (
    artifactId: string,
    role: "source" | "reference",
  ) => {
    const roles = expectedRoles.get(artifactId) ?? new Set();
    roles.add(role);
    expectedRoles.set(artifactId, roles);
  };

  addExpectedRole(importState.source.artifactId, "source");
  if (importState.reference) {
    addExpectedRole(importState.reference.artifactId, "reference");
  }
  if (importState.draft) {
    addExpectedRole(importState.draft.sourceArtifactId, "source");
    if (importState.draft.referenceArtifactId) {
      addExpectedRole(importState.draft.referenceArtifactId, "reference");
    }
  }

  for (const artifactId of referencedSubtitleArtifactIds(importState)) {
    const parsed = subtitleArtifactSchema.safeParse(
      artifactsById.get(artifactId),
    );
    const roles = expectedRoles.get(artifactId);
    if (
      !parsed.success ||
      !roles ||
      roles.size !== 1 ||
      !roles.has(parsed.data.role)
    ) {
      return false;
    }
  }

  return true;
}

async function persistMigratedSession(
  database: IDBDatabase,
  session: ReviewSession,
) {
  const transaction = database.transaction(SESSION_STORE, "readwrite");
  transaction.objectStore(SESSION_STORE).put(session, ACTIVE_SESSION_KEY);
  await transactionResult(transaction);
}

export function createLocalSessionStore(
  indexedDb: IDBFactory | undefined,
): LocalSessionStore {
  async function withDatabase<T>(
    operation: (database: IDBDatabase) => Promise<T>,
    fallback: T,
  ): Promise<T> {
    if (!indexedDb) return fallback;

    try {
      const database = await openDatabase(indexedDb);
      try {
        return await operation(database);
      } finally {
        database.close();
      }
    } catch {
      return fallback;
    }
  }

  async function load(): Promise<LocalWorkspaceResult> {
    return withDatabase<LocalWorkspaceResult>(async (database) => {
      const records = await readWorkspaceRecords(database);
      if ("kind" in records) return records;

      let session: ReviewSession | null = null;
      if (records.session !== undefined) {
        const migration = migrateReviewSession(records.session);
        if (migration.kind === "invalid") return corrupt(migration.reason);
        session = migration.session;
        if (migration.kind === "migrated") {
          await persistMigratedSession(database, session);
        }
      }

      let subtitleImport: PersistedSubtitleImport | null = null;
      if (records.subtitleImport !== undefined) {
        const parsed = persistedSubtitleImportSchema.safeParse(
          records.subtitleImport,
        );
        if (!parsed.success) {
          return corrupt(
            "The saved local subtitle import cannot be read safely.",
          );
        }
        subtitleImport = parsed.data;
      }

      if (
        session?.origin.kind === "subtitle" &&
        subtitleImport?.id !== session.origin.importId
      ) {
        return corrupt(
          "The saved local subtitle import cannot be read safely.",
        );
      }

      const artifactIds = subtitleImport
        ? [...referencedSubtitleArtifactIds(subtitleImport)]
        : [];
      const artifacts = parseArtifacts(artifactIds, records.artifacts);
      if (artifacts === null) {
        return corrupt(
          "The saved local subtitle artifacts cannot be read safely.",
        );
      }
      if (
        subtitleImport &&
        !hasValidArtifactRelationship(
          subtitleImport,
          new Map(artifacts.map((artifact) => [artifact.id, artifact])),
        )
      ) {
        return corrupt(
          "The saved local subtitle artifacts cannot be read safely.",
        );
      }

      const parsedPreferences =
        records.preferences === undefined
          ? workspacePreferencesSchema.safeParse({ showSpeakerNames: true })
          : workspacePreferencesSchema.safeParse(records.preferences);
      if (!parsedPreferences.success) {
        return corrupt(
          "The saved local workspace preferences cannot be read safely.",
        );
      }

      const snapshot: LocalWorkspaceSnapshot = {
        session,
        subtitleImport,
        artifacts,
        preferences: parsedPreferences.data,
      };
      return { kind: "available", snapshot, session };
    }, unavailable("Browser storage is unavailable. Your review content stays on this device."));
  }

  async function saveSession(
    session: ReviewSession,
  ): Promise<LocalWorkspaceSaveResult> {
    const parsed = reviewSessionSchema.safeParse(session);
    if (!parsed.success) {
      return unavailable(
        "The local review session is incomplete and was not saved.",
      );
    }

    return withDatabase<LocalWorkspaceSaveResult>(async (database) => {
      const transaction = database.transaction(SESSION_STORE, "readwrite");
      transaction
        .objectStore(SESSION_STORE)
        .put(parsed.data, ACTIVE_SESSION_KEY);
      await transactionResult(transaction);
      return { kind: "saved" };
    }, unavailable("Browser storage is unavailable. Your review content stays on this device."));
  }

  async function saveSubtitleImport(
    input: SaveSubtitleImportInput,
  ): Promise<LocalWorkspaceSaveResult> {
    const parsed = saveSubtitleImportInputSchema.safeParse(input);
    if (!parsed.success) {
      return unavailable(
        "The local subtitle import is incomplete and was not saved.",
      );
    }

    return withDatabase<LocalWorkspaceSaveResult>(async (database) => {
      const transaction = database.transaction(
        [SUBTITLE_IMPORT_STORE, SUBTITLE_ARTIFACT_STORE],
        "readwrite",
      );
      const completed = transactionResult(transaction);
      const artifactStore = transaction.objectStore(SUBTITLE_ARTIFACT_STORE);
      const putArtifacts = new Map(
        parsed.data.putArtifacts.map((artifact) => [artifact.id, artifact]),
      );
      const deletedArtifactIds = new Set(parsed.data.deleteArtifactIds);
      const storedArtifactIds = [
        ...referencedSubtitleArtifactIds(parsed.data.importState),
      ].filter(
        (artifactId) =>
          !putArtifacts.has(artifactId) && !deletedArtifactIds.has(artifactId),
      );
      const storedArtifacts = await Promise.all(
        storedArtifactIds.map((artifactId) =>
          requestResult(artifactStore.get(artifactId)),
        ),
      );
      const resultingArtifacts = new Map<string, unknown>(putArtifacts);
      storedArtifactIds.forEach((artifactId, index) => {
        resultingArtifacts.set(artifactId, storedArtifacts[index]);
      });

      if (
        !hasValidArtifactRelationship(
          parsed.data.importState,
          resultingArtifacts,
        )
      ) {
        transaction.abort();
        await completed.catch(() => undefined);
        return unavailable(
          "The local subtitle import references unavailable file data and was not saved.",
        );
      }

      for (const artifact of parsed.data.putArtifacts) {
        artifactStore.put(artifact, artifact.id);
      }
      for (const artifactId of parsed.data.deleteArtifactIds) {
        artifactStore.delete(artifactId);
      }
      transaction
        .objectStore(SUBTITLE_IMPORT_STORE)
        .put(parsed.data.importState, CURRENT_SUBTITLE_IMPORT_KEY);
      await completed;
      return { kind: "saved" };
    }, unavailable("Browser storage is unavailable. Your review content stays on this device."));
  }

  async function savePreferences(
    preferences: WorkspacePreferences,
  ): Promise<LocalWorkspaceSaveResult> {
    const parsed = workspacePreferencesSchema.safeParse(preferences);
    if (!parsed.success) {
      return unavailable(
        "The local workspace preferences are incomplete and were not saved.",
      );
    }

    return withDatabase<LocalWorkspaceSaveResult>(async (database) => {
      const transaction = database.transaction(PREFERENCE_STORE, "readwrite");
      transaction
        .objectStore(PREFERENCE_STORE)
        .put(parsed.data, WORKSPACE_PREFERENCE_KEY);
      await transactionResult(transaction);
      return { kind: "saved" };
    }, unavailable("Browser storage is unavailable. Your review content stays on this device."));
  }

  async function clearReviewContent(): Promise<LocalWorkspaceSaveResult> {
    return withDatabase<LocalWorkspaceSaveResult>(async (database) => {
      const transaction = database.transaction(
        [SESSION_STORE, SUBTITLE_IMPORT_STORE, SUBTITLE_ARTIFACT_STORE],
        "readwrite",
      );
      transaction.objectStore(SESSION_STORE).clear();
      transaction.objectStore(SUBTITLE_IMPORT_STORE).clear();
      transaction.objectStore(SUBTITLE_ARTIFACT_STORE).clear();
      await transactionResult(transaction);
      return { kind: "saved" };
    }, unavailable("Browser storage is unavailable. Your review content stays on this device."));
  }

  return {
    load,
    saveSession,
    saveSubtitleImport,
    savePreferences,
    clearReviewContent,
    save: saveSession,
    clear: clearReviewContent,
  };
}

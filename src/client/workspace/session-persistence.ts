import type { ReviewSession } from "./model";
import type {
  LocalWorkspaceSaveResult,
  LocalWorkspaceStore,
  SaveSubtitleImportInput,
  WorkspacePreferences,
} from "./session-store";

export type QueuedWorkspaceSaveResult =
  LocalWorkspaceSaveResult | Readonly<{ kind: "ignored" }>;

export interface WorkspacePersistenceQueue {
  beginReviewContent(): void;
  clearReviewContent(): Promise<LocalWorkspaceSaveResult>;
  savePreferences(
    preferences: WorkspacePreferences,
  ): Promise<LocalWorkspaceSaveResult>;
  saveSession(session: ReviewSession): Promise<QueuedWorkspaceSaveResult>;
  saveSubtitleImport(
    input: SaveSubtitleImportInput,
  ): Promise<QueuedWorkspaceSaveResult>;
  settle(): Promise<void>;
}

export function createWorkspacePersistenceQueue(
  getStore: () => LocalWorkspaceStore,
): WorkspacePersistenceQueue {
  let queue = Promise.resolve<unknown>(undefined);
  let reviewContentBlocked = false;
  let barrierGeneration = 0;
  let pendingClear: Promise<LocalWorkspaceSaveResult> | null = null;

  function enqueue<T>(operation: () => Promise<T>) {
    const result = queue.then(operation, operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function beginReviewContent() {
    barrierGeneration += 1;
    reviewContentBlocked = false;
    pendingClear = null;
  }

  function saveReviewContent(
    operation: (
      store: LocalWorkspaceStore,
    ) => Promise<LocalWorkspaceSaveResult>,
  ): Promise<QueuedWorkspaceSaveResult> {
    if (reviewContentBlocked) {
      return Promise.resolve({ kind: "ignored" });
    }
    return enqueue(() => operation(getStore()));
  }

  function clearReviewContent() {
    if (pendingClear) return pendingClear;

    const generation = ++barrierGeneration;
    reviewContentBlocked = true;
    const clearing = enqueue(() => getStore().clearReviewContent());
    const result = clearing.then(
      (clearResult) => {
        if (
          clearResult.kind === "unavailable" &&
          barrierGeneration === generation
        ) {
          reviewContentBlocked = false;
        }
        if (pendingClear === result) pendingClear = null;
        return clearResult;
      },
      (error: unknown) => {
        if (barrierGeneration === generation) reviewContentBlocked = false;
        if (pendingClear === result) pendingClear = null;
        throw error;
      },
    );
    pendingClear = result;
    return result;
  }

  function saveSession(session: ReviewSession) {
    return saveReviewContent((store) => store.saveSession(session));
  }

  const persistence: WorkspacePersistenceQueue = {
    beginReviewContent,
    clearReviewContent,
    savePreferences(preferences) {
      return enqueue(() => getStore().savePreferences(preferences));
    },
    saveSession,
    saveSubtitleImport(input) {
      return saveReviewContent((store) => store.saveSubtitleImport(input));
    },
    settle() {
      return queue.then(() => undefined);
    },
  };
  return persistence;
}

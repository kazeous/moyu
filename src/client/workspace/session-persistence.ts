import type { ReviewSession } from "./model";
import type {
  LocalSessionSaveResult,
  LocalSessionStore,
} from "./session-store";

export type QueuedSessionSaveResult =
  LocalSessionSaveResult | { kind: "ignored" };

export interface SessionPersistenceQueue {
  beginSession(): void;
  clear(): Promise<LocalSessionSaveResult>;
  save(session: ReviewSession): Promise<QueuedSessionSaveResult>;
}

export function createSessionPersistenceQueue(
  getStore: () => LocalSessionStore,
): SessionPersistenceQueue {
  let queue = Promise.resolve<unknown>(undefined);
  let clearRequested = false;
  let pendingClear: Promise<LocalSessionSaveResult> | null = null;

  function enqueue<T>(operation: () => Promise<T>) {
    const result = queue.then(operation, operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    beginSession() {
      clearRequested = false;
      pendingClear = null;
    },

    clear() {
      if (pendingClear) {
        return pendingClear;
      }

      clearRequested = true;
      pendingClear = enqueue(() => getStore().clear()).then((result) => {
        if (result.kind === "unavailable") {
          clearRequested = false;
          pendingClear = null;
        }

        return result;
      });
      return pendingClear;
    },

    save(session) {
      if (clearRequested) {
        return Promise.resolve({ kind: "ignored" } as const);
      }

      return enqueue(() => getStore().save(session));
    },
  };
}

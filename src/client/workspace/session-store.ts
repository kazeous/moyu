import { reviewSessionSchema, type ReviewSession } from "./model";

const DATABASE_NAME = "moyu-local-review";
const DATABASE_VERSION = 1;
const SESSION_STORE = "sessions";
const ACTIVE_SESSION_KEY = "active";

export type LocalSessionResult =
  | { kind: "available"; session: ReviewSession }
  | { kind: "empty" }
  | { kind: "corrupt"; reason: string }
  | { kind: "unavailable"; reason: string };

export type LocalSessionSaveResult =
  { kind: "saved" } | { kind: "unavailable"; reason: string };

export interface LocalSessionStore {
  clear(): Promise<LocalSessionSaveResult>;
  load(): Promise<LocalSessionResult>;
  save(session: ReviewSession): Promise<LocalSessionSaveResult>;
}

function unavailable(reason: string): { kind: "unavailable"; reason: string } {
  return { kind: "unavailable", reason };
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
        if (!request.result.objectStoreNames.contains(SESSION_STORE)) {
          request.result.createObjectStore(SESSION_STORE);
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

export function createLocalSessionStore(
  indexedDb: IDBFactory | undefined,
): LocalSessionStore {
  async function withDatabase<T>(
    operation: (database: IDBDatabase) => Promise<T>,
    fallback: T,
  ): Promise<T> {
    if (!indexedDb) {
      return fallback;
    }

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

  return {
    async load() {
      return withDatabase<LocalSessionResult>(async (database) => {
        const transaction = database.transaction(SESSION_STORE, "readonly");
        const completed = transactionResult(transaction);
        const value = await requestResult(
          transaction.objectStore(SESSION_STORE).get(ACTIVE_SESSION_KEY),
        );
        await completed;

        if (value === undefined) {
          return { kind: "empty" } as const;
        }

        const parsed = reviewSessionSchema.safeParse(value);

        return parsed.success
          ? ({ kind: "available", session: parsed.data } as const)
          : ({
              kind: "corrupt",
              reason: "The saved local review session cannot be read safely.",
            } as const);
      }, unavailable("Browser storage is unavailable. Your review content stays on this device."));
    },

    async save(session) {
      const parsed = reviewSessionSchema.safeParse(session);

      if (!parsed.success) {
        return unavailable(
          "The local review session is incomplete and was not saved.",
        );
      }

      return withDatabase<LocalSessionSaveResult>(async (database) => {
        const transaction = database.transaction(SESSION_STORE, "readwrite");
        transaction
          .objectStore(SESSION_STORE)
          .put(parsed.data, ACTIVE_SESSION_KEY);
        await transactionResult(transaction);
        return { kind: "saved" } as const;
      }, unavailable("Browser storage is unavailable. Your review content stays on this device."));
    },

    async clear() {
      return withDatabase<LocalSessionSaveResult>(async (database) => {
        const transaction = database.transaction(SESSION_STORE, "readwrite");
        transaction.objectStore(SESSION_STORE).delete(ACTIVE_SESSION_KEY);
        await transactionResult(transaction);
        return { kind: "saved" } as const;
      }, unavailable("Browser storage is unavailable. Your review content stays on this device."));
    },
  };
}

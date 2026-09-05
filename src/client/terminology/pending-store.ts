import { z } from "zod";
import { pendingPhraseSchema, type PendingPhrase } from "./contracts";

// Account metadata has a separate database, outside Clear session's review stores.
const DATABASE = "moyu-personal-library";
const STORE = "pending-phrases";

export function createPendingPhraseStore(indexedDb: IDBFactory | undefined) {
  async function database() {
    if (!indexedDb) throw new Error("Personal library storage unavailable.");
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDb.open(DATABASE, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error("Personal library storage unavailable."));
      request.onblocked = () =>
        reject(new Error("Personal library storage unavailable."));
    });
  }
  async function transact<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await database();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = operation(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () =>
          reject(new Error("Personal library storage unavailable."));
      });
    } finally {
      db.close();
    }
  }
  return {
    async list(ownerId: string) {
      z.uuid().parse(ownerId);
      const records: unknown = await transact("readonly", (store) =>
        store.getAll(),
      );
      const pending: PendingPhrase[] = [];
      let hasUnreadableRecords = false;
      for (const record of z.array(z.unknown()).parse(records)) {
        const parsed = pendingPhraseSchema.safeParse(record);
        if (!parsed.success) {
          hasUnreadableRecords = true;
        } else if (parsed.data.ownerId === ownerId) {
          pending.push(parsed.data);
        }
      }
      // Read-only recovery: invalid rows stay intact and are never sent or shown.
      return { pending, hasUnreadableRecords };
    },
    async put(record: PendingPhrase) {
      const parsed = pendingPhraseSchema.parse(record);
      await transact("readwrite", (store) => store.put(parsed));
    },
    async remove(id: string) {
      z.uuid().parse(id);
      await transact("readwrite", (store) => store.delete(id));
    },
  };
}
export type PendingPhraseStore = ReturnType<typeof createPendingPhraseStore>;

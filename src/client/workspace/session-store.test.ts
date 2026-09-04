import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import type { ReviewSession } from "./model";
import { createLocalSessionStore } from "./session-store";

const session: ReviewSession = {
  version: 1,
  sourceLanguage: "ja",
  referenceLanguage: "en",
  rawImportText: "  原文  \n  Reference  ",
  lines: [{ id: "line-1", source: "  原文  ", reference: "  Reference  " }],
  activeLineId: "line-1",
  evidencePanelWidth: 360,
};

describe("createLocalSessionStore", () => {
  it("round-trips exact review text and clears the active session", async () => {
    const store = createLocalSessionStore(new IDBFactory());

    expect(await store.save(session)).toEqual({ kind: "saved" });
    expect(await store.load()).toEqual({ kind: "available", session });
    expect(await store.clear()).toEqual({ kind: "saved" });
    expect(await store.load()).toEqual({ kind: "empty" });
  });

  it("rejects unknown persisted fields instead of silently discarding them", async () => {
    const store = createLocalSessionStore(new IDBFactory());
    const unsafeSession = {
      ...session,
      lines: [{ ...session.lines[0], serverId: "must-not-cross-boundaries" }],
    } as unknown as ReviewSession;

    expect(await store.save(unsafeSession)).toEqual({
      kind: "unavailable",
      reason: "The local review session is incomplete and was not saved.",
    });
  });

  it("returns an explicit unavailable state when IndexedDB is absent", async () => {
    const store = createLocalSessionStore(undefined);

    await expect(store.load()).resolves.toMatchObject({ kind: "unavailable" });
    await expect(store.save(session)).resolves.toMatchObject({
      kind: "unavailable",
    });
    await expect(store.clear()).resolves.toMatchObject({ kind: "unavailable" });
  });

  it("distinguishes unreadable local data so the user can clear it", async () => {
    const indexedDb = new IDBFactory();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDb.open("moyu-local-review", 1);
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
      request.addEventListener(
        "upgradeneeded",
        () => request.result.createObjectStore("sessions"),
        { once: true },
      );
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
    });
    const transaction = database.transaction("sessions", "readwrite");
    transaction.objectStore("sessions").put({ version: 999 }, "active");
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("error", () => reject(transaction.error), {
        once: true,
      });
    });
    database.close();

    await expect(createLocalSessionStore(indexedDb).load()).resolves.toEqual({
      kind: "corrupt",
      reason: "The saved local review session cannot be read safely.",
    });
  });
});

import { describe, expect, it } from "vitest";

import type { ReviewSession } from "./model";
import { createSessionPersistenceQueue } from "./session-persistence";
import type { LocalSessionStore } from "./session-store";

const session: ReviewSession = {
  version: 1,
  sourceLanguage: "ja",
  referenceLanguage: "en",
  rawImportText: "原文",
  lines: [{ id: "line-1", source: "原文" }],
  activeLineId: "line-1",
  evidencePanelWidth: 360,
};

describe("createSessionPersistenceQueue", () => {
  it("never lets a save requested after clear repopulate the session", async () => {
    let releaseFirstSave: () => void = () => {};
    let persisted: ReviewSession | undefined;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const store: LocalSessionStore = {
      async load() {
        return { kind: "empty" };
      },
      async save(nextSession) {
        await firstSave;
        persisted = nextSession;
        return { kind: "saved" };
      },
      async clear() {
        persisted = undefined;
        return { kind: "saved" };
      },
    };
    const queue = createSessionPersistenceQueue(() => store);

    const save = queue.save(session);
    const clear = queue.clear();
    const staleSave = queue.save({ ...session, evidencePanelWidth: 420 });
    releaseFirstSave();

    await expect(save).resolves.toEqual({ kind: "saved" });
    await expect(clear).resolves.toEqual({ kind: "saved" });
    await expect(staleSave).resolves.toEqual({ kind: "ignored" });
    expect(persisted).toBeUndefined();
  });

  it("allows a new imported session after an explicit restart", async () => {
    const calls: string[] = [];
    const store: LocalSessionStore = {
      async load() {
        return { kind: "empty" };
      },
      async save() {
        calls.push("save");
        return { kind: "saved" };
      },
      async clear() {
        calls.push("clear");
        return { kind: "saved" };
      },
    };
    const queue = createSessionPersistenceQueue(() => store);

    await queue.clear();
    queue.beginSession();
    await queue.save(session);

    expect(calls).toEqual(["clear", "save"]);
  });
});

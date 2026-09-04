import { describe, expect, it } from "vitest";

import type { ReviewSession } from "./model";
import { createSessionPersistenceQueue } from "./session-persistence";
import type {
  LocalWorkspaceStore,
  SaveSubtitleImportInput,
  WorkspacePreferences,
} from "./session-store";
import type { SubtitleArtifact } from "./subtitles/contracts";
import type { PersistedSubtitleImport } from "./subtitles/import-record";

const session: ReviewSession = {
  version: 2,
  sourceLanguage: "ja",
  referenceLanguage: "en",
  origin: { kind: "paste", rawImportText: "原文" },
  lines: [{ id: "line-1", source: "原文" }],
  activeLineId: "line-1",
  evidencePanelWidth: 360,
};
const bytes = new Blob(["source"]);
const sourceArtifact: SubtitleArtifact = {
  id: "source",
  role: "source",
  name: "source.srt",
  size: bytes.size,
  format: "srt",
  requestedEncoding: "utf-8",
  resolvedEncoding: "utf-8",
  bytes,
  status: "decoded",
};
const importState: PersistedSubtitleImport = {
  version: 1,
  id: "import-1",
  source: { artifactId: sourceArtifact.id, language: "ja" },
  reference: null,
  draft: null,
  failure: null,
};
const importInput: SaveSubtitleImportInput = {
  importState,
  putArtifacts: [sourceArtifact],
  deleteArtifactIds: [],
};

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function memoryStore(overrides: Partial<LocalWorkspaceStore> = {}) {
  const calls: string[] = [];
  const store: LocalWorkspaceStore = {
    async load() {
      calls.push("load");
      return {
        kind: "available",
        snapshot: {
          session: null,
          subtitleImport: null,
          artifacts: [],
          preferences: { showSpeakerNames: true },
        },
        session: null,
      };
    },
    async saveSession() {
      calls.push("session");
      return { kind: "saved" };
    },
    async saveSubtitleImport() {
      calls.push("subtitle");
      return { kind: "saved" };
    },
    async savePreferences() {
      calls.push("preferences");
      return { kind: "saved" };
    },
    async clearReviewContent() {
      calls.push("clear");
      return { kind: "saved" };
    },
    ...overrides,
  };
  return { calls, store };
}

describe("createSessionPersistenceQueue", () => {
  it("ignores session and subtitle saves requested after clear until review content begins", async () => {
    const firstSave = deferred();
    const { calls, store } = memoryStore({
      async saveSession() {
        calls.push("session");
        await firstSave.promise;
        return { kind: "saved" };
      },
    });
    const queue = createSessionPersistenceQueue(() => store);

    const savedBeforeClear = queue.saveSession(session);
    const clear = queue.clearReviewContent();
    const staleSession = queue.saveSession({
      ...session,
      evidencePanelWidth: 420,
    });
    const staleSubtitle = queue.saveSubtitleImport(importInput);
    firstSave.resolve();

    await expect(savedBeforeClear).resolves.toEqual({ kind: "saved" });
    await expect(clear).resolves.toEqual({ kind: "saved" });
    await expect(staleSession).resolves.toEqual({ kind: "ignored" });
    await expect(staleSubtitle).resolves.toEqual({ kind: "ignored" });
    expect(calls).toEqual(["session", "clear"]);

    queue.beginReviewContent();
    await expect(queue.saveSubtitleImport(importInput)).resolves.toEqual({
      kind: "saved",
    });
    await expect(queue.saveSession(session)).resolves.toEqual({
      kind: "saved",
    });
    expect(calls).toEqual(["session", "clear", "subtitle", "session"]);
  });

  it("continues to serialize preference saves while review content is cleared", async () => {
    const clear = deferred();
    const { calls, store } = memoryStore({
      async clearReviewContent() {
        calls.push("clear:start");
        await clear.promise;
        calls.push("clear:end");
        return { kind: "saved" };
      },
      async savePreferences(preferences: WorkspacePreferences) {
        calls.push(`preferences:${preferences.showSpeakerNames}`);
        return { kind: "saved" };
      },
    });
    const queue = createSessionPersistenceQueue(() => store);

    const clearing = queue.clearReviewContent();
    const preferenceSave = queue.savePreferences({ showSpeakerNames: false });
    await Promise.resolve();
    expect(calls).toEqual(["clear:start"]);
    clear.resolve();

    await expect(clearing).resolves.toEqual({ kind: "saved" });
    await expect(preferenceSave).resolves.toEqual({ kind: "saved" });
    expect(calls).toEqual(["clear:start", "clear:end", "preferences:false"]);
  });

  it("settle waits for every operation requested before it", async () => {
    const save = deferred();
    const { store } = memoryStore({
      async saveSubtitleImport() {
        await save.promise;
        return { kind: "saved" };
      },
    });
    const queue = createSessionPersistenceQueue(() => store);
    let settled = false;

    void queue.saveSubtitleImport(importInput);
    const settling = queue.settle().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    save.resolve();
    await settling;
    expect(settled).toBe(true);
  });

  it("reopens review saves and clear retry after a failed clear", async () => {
    let clearAttempts = 0;
    const { calls, store } = memoryStore({
      async clearReviewContent() {
        clearAttempts += 1;
        calls.push(`clear:${clearAttempts}`);
        return clearAttempts === 1
          ? { kind: "unavailable", reason: "clear failed" }
          : { kind: "saved" };
      },
    });
    const queue = createSessionPersistenceQueue(() => store);

    await expect(queue.clearReviewContent()).resolves.toEqual({
      kind: "unavailable",
      reason: "clear failed",
    });
    await expect(queue.saveSession(session)).resolves.toEqual({
      kind: "saved",
    });
    await expect(queue.clearReviewContent()).resolves.toEqual({
      kind: "saved",
    });
    await expect(queue.saveSession(session)).resolves.toEqual({
      kind: "ignored",
    });
    expect(calls).toEqual(["clear:1", "session", "clear:2"]);
  });
});

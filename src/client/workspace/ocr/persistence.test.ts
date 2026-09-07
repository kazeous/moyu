import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { createLocalSessionStore } from "../session-store";
import { createWorkspacePersistenceQueue } from "../session-persistence";
import { createOcrImport, reviewFromOcr } from "./contracts";

it("retains original images and corrections across reload and clears all OCR with review content", async () => {
  const factory = new IDBFactory();
  const store = createLocalSessionStore(factory);
  const draft = {
    ...createOcrImport(
      new Blob(["private-image"], { type: "image/png" }),
      "jpn",
      "ocr-1",
    ),
    editedText: "私の原文",
    mode: "alternating" as const,
    referenceLanguage: "vi" as const,
  };
  expect(await store.saveOcrImport(draft)).toEqual({ kind: "saved" });
  expect(
    await store.saveSession(
      reviewFromOcr(draft, "source-only", "en", () => "line-1"),
    ),
  ).toEqual({ kind: "saved" });
  const reloaded = await createLocalSessionStore(factory).load();
  expect(reloaded.kind).toBe("available");
  if (reloaded.kind !== "available") return;
  expect(reloaded.snapshot.ocrImports[0]?.editedText).toBe("私の原文");
  expect(reloaded.snapshot.ocrImports[0]).toMatchObject({
    mode: "alternating",
    referenceLanguage: "vi",
  });
  expect(await reloaded.snapshot.ocrImports[0]?.image.text()).toBe(
    "private-image",
  );
  await store.savePreferences({ showSpeakerNames: false });
  const queue = createWorkspacePersistenceQueue(() => store);
  const pending = queue.saveOcrImport(draft);
  const cleared = queue.clearReviewContent();
  expect(await queue.saveOcrImport(draft)).toEqual({ kind: "ignored" });
  await pending;
  await cleared;
  const result = await store.load();
  expect(result.kind === "available" && result.snapshot).toMatchObject({
    session: null,
    ocrImports: [],
    preferences: { showSpeakerNames: false },
  });
});

it("refuses an OCR session without its original image", async () => {
  const store = createLocalSessionStore(new IDBFactory());
  const draft = {
    ...createOcrImport(
      new Blob(["png"], { type: "image/png" }),
      "jpn",
      "missing",
    ),
    editedText: "原文",
  };
  expect(
    (
      await store.saveSession(
        reviewFromOcr(draft, "source-only", "en", () => "1"),
      )
    ).kind,
  ).toBe("unavailable");
});

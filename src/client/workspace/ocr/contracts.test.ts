import { describe, expect, it } from "vitest";
import {
  createOcrImport,
  ocrImportSchema,
  reviewFromOcr,
  serializeOcrImport,
  restoreOcrImport,
} from "./contracts";

describe("local OCR drafts", () => {
  it("stores image bytes in a portable record and restores the exact Blob", async () => {
    const draft = createOcrImport(
      new Blob(["original"], { type: "image/png" }),
      "jpn",
      "portable",
    );
    const record = await serializeOcrImport(draft);
    expect(record.image.bytes).toBeInstanceOf(ArrayBuffer);
    const restored = restoreOcrImport(structuredClone(record));
    expect(await restored.image.text()).toBe("original");
    expect(restored.image.type).toBe("image/png");
    expect(() =>
      restoreOcrImport({
        ...record,
        image: { type: "image/png", bytes: "not bytes" },
      }),
    ).toThrow();
  });
  it("preserves image bytes and separates recognition from editable correction", async () => {
    const bytes = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const draft = createOcrImport(bytes, "jpn", "image-1");
    const corrected = ocrImportSchema.parse({
      ...draft,
      rawText: "  原文\r\n",
      editedText: "  修正\nReference  ",
      confidence: 42,
      status: "recognized",
    });
    const session = reviewFromOcr(
      corrected,
      "alternating",
      "en",
      () => "line-1",
    );
    expect(session.lines).toEqual([
      { id: "line-1", source: "  修正", reference: "Reference  " },
    ]);
    expect(corrected.rawText).toBe("  原文\r\n");
    expect(await corrected.image.arrayBuffer()).toEqual(
      await bytes.arrayBuffer(),
    );
    expect(session.origin).toEqual({ kind: "ocr", importId: "image-1" });
  });

  it("rejects unsupported images, empty files, oversized files and invalid worker results", () => {
    expect(() =>
      createOcrImport(new Blob(["svg"], { type: "image/svg+xml" }), "jpn", "1"),
    ).toThrow();
    expect(() =>
      createOcrImport(new Blob([], { type: "image/png" }), "jpn", "1"),
    ).toThrow();
    expect(() =>
      createOcrImport(
        new Blob([new Uint8Array(25 * 1024 * 1024 + 1)], { type: "image/png" }),
        "jpn",
        "1",
      ),
    ).toThrow();
    const draft = createOcrImport(
      new Blob(["png"], { type: "image/png" }),
      "jpn",
      "1",
    );
    expect(
      ocrImportSchema.safeParse({ ...draft, confidence: 101 }).success,
    ).toBe(false);
    expect(() =>
      reviewFromOcr(draft, "source-only", "en", () => "1"),
    ).toThrow();
  });
});

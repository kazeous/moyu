import { describe, expect, it } from "vitest";

import {
  createReviewSessionFromLines,
  createReviewSession,
  prepareImport,
  suggestImportMode,
} from "./import";

describe("prepareImport", () => {
  it("preserves every source-only line exactly, including blank and trailing lines", () => {
    const result = prepareImport("第一行\n\n第三行\n", "source-only");

    expect(result.lines).toEqual([
      { source: "第一行" },
      { source: "" },
      { source: "第三行" },
      { source: "" },
    ]);
    expect(result.hasUnpairedLine).toBe(false);
  });

  it("pairs alternating source and reference lines without losing an odd final source", () => {
    const result = prepareImport(
      "行くよ。\nI'm going.\n二行目だけです。",
      "alternating",
    );

    expect(result.lines).toEqual([
      { source: "行くよ。", reference: "I'm going." },
      { source: "二行目だけです。" },
    ]);
    expect(result.hasUnpairedLine).toBe(true);
  });

  it("suggests source-only for a single line without changing the text", () => {
    expect(suggestImportMode("一行だけ")).toMatchObject({
      mode: "source-only",
      confidence: "likely",
    });
  });

  it("does not mistake multiple source-script lines for alternating references", () => {
    expect(suggestImportMode("一行目\n二行目\n三行目")).toMatchObject({
      mode: "source-only",
      confidence: "likely",
    });
  });

  it("suggests alternating only for consistent source-script and Latin pairs", () => {
    expect(
      suggestImportMode("一行目\nFirst line\n二行目\nSecond line"),
    ).toMatchObject({ mode: "alternating", confidence: "likely" });
  });

  it("marks mixed pairing evidence as uncertain with an explicit reason", () => {
    expect(suggestImportMode("一行目\n二行目\ntranslation")).toEqual({
      mode: "source-only",
      confidence: "uncertain",
      reason: "The line pattern is mixed, so pairing needs your confirmation.",
    });
  });
});

describe("createReviewSession", () => {
  it("creates a local review session with the first line selected", () => {
    const session = createReviewSession(
      "こんにちは\nHello",
      "alternating",
      "ja",
      "en",
    );

    expect(session.lines).toHaveLength(1);
    expect(session.lines[0]).toMatchObject({
      id: "line-1",
      source: "こんにちは",
      reference: "Hello",
    });
    expect(session.activeLineId).toBe("line-1");
    expect(session.sourceLanguage).toBe("ja");
    expect(session.referenceLanguage).toBe("en");
  });

  it("retains the exact original paste alongside derived review lines", () => {
    const rawImportText = "  こんにちは  \r\nHello  \r\n";
    const session = createReviewSession(
      rawImportText,
      "alternating",
      "ja",
      "en",
    );

    expect(
      (session as typeof session & { rawImportText?: string }).rawImportText,
    ).toBe(rawImportText);
  });

  it("uses a user-corrected pairing when creating the local session", () => {
    const proposed = prepareImport("早いね。\nYou are fast.", "alternating");
    const corrected = proposed.lines.map((line) => ({ ...line }));
    corrected[0].reference = "That was quick.";

    const session = createReviewSessionFromLines(
      corrected,
      "ja",
      "en",
      "早いね。\nYou are fast.",
    );

    expect(session.lines[0]).toMatchObject({
      source: "早いね。",
      reference: "That was quick.",
    });
  });
});

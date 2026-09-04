import { describe, expect, it } from "vitest";

import { reviewSessionSchema } from "./model";

const validSession = {
  version: 1 as const,
  sourceLanguage: "ja" as const,
  referenceLanguage: "en" as const,
  rawImportText: "一行目",
  lines: [{ id: "line-1", source: "一行目" }],
  activeLineId: "line-1",
  evidencePanelWidth: 360,
};

describe("reviewSessionSchema", () => {
  it("requires the active line to exist", () => {
    expect(
      reviewSessionSchema.safeParse({
        ...validSession,
        activeLineId: "missing-line",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate line identifiers", () => {
    expect(
      reviewSessionSchema.safeParse({
        ...validSession,
        lines: [...validSession.lines, { id: "line-1", source: "二行目" }],
      }).success,
    ).toBe(false);
  });

  it("requires null selection only for an empty session", () => {
    expect(
      reviewSessionSchema.safeParse({ ...validSession, activeLineId: null })
        .success,
    ).toBe(false);
    expect(
      reviewSessionSchema.safeParse({
        ...validSession,
        lines: [],
        activeLineId: null,
      }).success,
    ).toBe(true);
  });

  it("keeps the evidence panel within its persisted pixel bounds", () => {
    expect(
      reviewSessionSchema.safeParse({
        ...validSession,
        evidencePanelWidth: 279,
      }).success,
    ).toBe(false);
    expect(
      reviewSessionSchema.safeParse({
        ...validSession,
        evidencePanelWidth: 721,
      }).success,
    ).toBe(false);
  });
});

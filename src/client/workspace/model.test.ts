import { describe, expect, it } from "vitest";

import { migrateReviewSession, reviewSessionSchema } from "./model";

const validSession = {
  version: 2 as const,
  sourceLanguage: "ja" as const,
  referenceLanguage: "en" as const,
  origin: { kind: "paste" as const, rawImportText: "一行目" },
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

  it("validates subtitle provenance without losing nullable timing or speaker order", () => {
    const subtitleSession = {
      ...validSession,
      origin: { kind: "subtitle" as const, importId: "import-1" },
      lines: [
        {
          ...validSession.lines[0],
          subtitle: {
            sourceCueIds: ["s1", "s2"],
            referenceCueIds: [],
            startMs: null,
            endMs: null,
            speakers: ["春樹", "美月"],
          },
        },
      ],
    };

    expect(reviewSessionSchema.safeParse(subtitleSession).success).toBe(true);
    expect(
      reviewSessionSchema.safeParse({
        ...subtitleSession,
        lines: [
          {
            ...subtitleSession.lines[0],
            subtitle: {
              ...subtitleSession.lines[0].subtitle,
              sourceCueIds: [],
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      reviewSessionSchema.safeParse({
        ...subtitleSession,
        lines: [
          {
            ...subtitleSession.lines[0],
            subtitle: {
              ...subtitleSession.lines[0].subtitle,
              speakers: ["春樹", "春樹"],
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("migrateReviewSession", () => {
  it("migrates a v1 paste session without changing user text or selection", () => {
    const legacy = {
      version: 1,
      sourceLanguage: "ja",
      referenceLanguage: "en",
      rawImportText: "  原文  \r\nReference  ",
      lines: [{ id: "line-1", source: "  原文  ", reference: "Reference  " }],
      activeLineId: "line-1",
      evidencePanelWidth: 412,
    };

    expect(migrateReviewSession(legacy)).toEqual({
      kind: "migrated",
      fromVersion: 1,
      session: {
        version: 2,
        sourceLanguage: "ja",
        referenceLanguage: "en",
        origin: { kind: "paste", rawImportText: legacy.rawImportText },
        lines: legacy.lines,
        activeLineId: "line-1",
        evidencePanelWidth: 412,
      },
    });
  });

  it("returns an already-current v2 session without changing it", () => {
    expect(migrateReviewSession(validSession)).toEqual({
      kind: "current",
      session: validSession,
    });
  });

  it.each([{ version: 999 }, { version: 2, lines: [], unknown: true }])(
    "rejects invalid or future persisted state",
    (value) =>
      expect(migrateReviewSession(value)).toMatchObject({ kind: "invalid" }),
  );
});

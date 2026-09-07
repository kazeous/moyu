import { describe, expect, it } from "vitest";

import type { SubtitleCue, SubtitleProcessingFailure } from "./contracts";
import { createSubtitleImportDraft, keepSourceOnly } from "./draft";
import {
  persistedSubtitleImportSchema,
  referencedSubtitleArtifactIds,
} from "./import-record";

function cue(artifactId: string): SubtitleCue {
  return {
    id: `${artifactId}:cue:0`,
    artifactId,
    sourceOrder: 0,
    startMs: 0,
    endMs: 1_000,
    rawPayload: "raw source",
    visibleText: "source",
    warnings: [],
  };
}

function usableDraftFor(sourceArtifactId: string) {
  const draft = createSubtitleImportDraft({
    id: "import-1",
    sourceArtifactId,
    sourceLanguage: "ja",
    referenceLanguage: "en",
    sourceCues: [cue(sourceArtifactId)],
    referenceCues: [],
  });
  return keepSourceOnly(draft, draft.groups[0].id);
}

const replacementDecodeFailure: SubtitleProcessingFailure = {
  kind: "processing-error",
  code: "invalid-encoding",
  role: "source",
  retryable: true,
  message: "The file is not valid utf-8.",
};

describe("persistedSubtitleImportSchema", () => {
  it("persists a failed attempt without requiring parsed cues", () => {
    expect(
      persistedSubtitleImportSchema.parse({
        version: 1,
        id: "import-1",
        source: { artifactId: "attempt-source", language: "ja" },
        reference: null,
        draft: null,
        failure: replacementDecodeFailure,
      }),
    ).toBeTruthy();
  });

  it("retains the last usable draft while a replacement attempt fails", () => {
    const record = persistedSubtitleImportSchema.parse({
      version: 1,
      id: "import-1",
      source: { artifactId: "replacement-source", language: "ja" },
      reference: null,
      draft: usableDraftFor("previous-source"),
      failure: replacementDecodeFailure,
    });

    expect(record.draft?.sourceArtifactId).toBe("previous-source");
    expect(referencedSubtitleArtifactIds(record)).toEqual(
      new Set(["replacement-source", "previous-source"]),
    );
  });

  it("rejects unknown fields at every persisted record boundary", () => {
    expect(
      persistedSubtitleImportSchema.safeParse({
        version: 1,
        id: "import-1",
        source: {
          artifactId: "attempt-source",
          language: "ja",
          remoteUrl: "must-not-be-persisted",
        },
        reference: null,
        draft: null,
        failure: replacementDecodeFailure,
      }).success,
    ).toBe(false);
  });
});

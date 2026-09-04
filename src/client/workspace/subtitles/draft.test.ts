import { describe, expect, it } from "vitest";
import {
  subtitleImportDraftSchema,
  type SubtitleCue,
  type SubtitleImportDraft,
  type SubtitleProcessingFailure,
} from "./contracts";
import {
  acceptAlignmentGroup,
  attachReferences,
  createReviewLinesFromSubtitleDraft,
  createSubtitleImportDraft,
  detachReferences,
  ignoreReference,
  isSubtitleDraftReady,
  keepSourceOnly,
  splitSourceGroup,
  validateCueConservation,
} from "./draft";

function cue(
  id: string,
  startMs: number | null,
  endMs: number | null,
  sourceOrder: number,
  speaker?: string,
): SubtitleCue {
  return {
    id,
    artifactId: id.startsWith("s") ? "source" : "reference",
    sourceOrder,
    startMs,
    endMs,
    rawPayload: `raw:${id}`,
    visibleText: `text:${id}`,
    ...(speaker === undefined ? {} : { speaker }),
    warnings: [],
  };
}

function draftFrom(
  sourceCues: readonly SubtitleCue[],
  referenceCues: readonly SubtitleCue[] = [],
  blockingFailures: readonly SubtitleProcessingFailure[] = [],
) {
  return createSubtitleImportDraft({
    id: "import-1",
    sourceArtifactId: "source",
    ...(referenceCues.length === 0 ? {} : { referenceArtifactId: "reference" }),
    sourceLanguage: "ja",
    referenceLanguage: "en",
    sourceCues,
    referenceCues,
    blockingFailures,
  });
}

function draftWithUnassignedReference() {
  return draftFrom([cue("s1", 0, 1_000, 0)], [cue("r1", 2_000, 3_000, 0)]);
}

describe("subtitle import draft corrections", () => {
  it("requires explicit source-only and ignored-reference outcomes", () => {
    const draft = draftFrom(
      [cue("s1", 0, 1_000, 0)],
      [cue("r1", 2_000, 3_000, 0)],
    );
    expect(isSubtitleDraftReady(draft)).toBe(false);

    const sourceResolved = keepSourceOnly(draft, draft.groups[0].id);
    expect(isSubtitleDraftReady(sourceResolved)).toBe(false);

    const complete = ignoreReference(sourceResolved, "r1");
    expect(isSubtitleDraftReady(complete)).toBe(true);
  });

  it("attach is an explicit accepted decision and detach returns the cue to the tray", () => {
    const draft = draftWithUnassignedReference();
    const attached = attachReferences(draft, draft.groups[0].id, ["r1"]);
    expect(attached.groups[0].decision).toBe("accepted");
    expect(attached.unassignedReferenceCueIds).not.toContain("r1");

    const detached = detachReferences(attached, draft.groups[0].id, ["r1"]);
    expect(detached.groups[0].decision).toBe("pending");
    expect(detached.unassignedReferenceCueIds).toContain("r1");
  });

  it("accounts for every cue exactly once after every edit", () => {
    const initial = draftFrom(
      [cue("s1", 0, 2_000, 0), cue("s2", 1_500, 3_000, 1)],
      [cue("r1", 0, 2_200, 0), cue("r2", 1_800, 3_000, 1)],
    );
    const accepted = acceptAlignmentGroup(initial, initial.groups[0].id);
    const split = splitSourceGroup(accepted, accepted.groups[0].id);
    const attached = attachReferences(split, split.groups[0].id, ["r1", "r2"]);
    const detached = detachReferences(attached, attached.groups[0].id, ["r2"]);
    const sourceOnly = keepSourceOnly(detached, detached.groups[1].id);
    const ignored = ignoreReference(sourceOnly, "r2");

    for (const state of [
      initial,
      accepted,
      split,
      attached,
      detached,
      sourceOnly,
      ignored,
    ]) {
      expect(validateCueConservation(state)).toEqual({ kind: "valid" });
    }
  });

  it("accepts an ambiguous group without changing its original cues", () => {
    const draft = draftFrom(
      [cue("s1", 0, 2_000, 0), cue("s2", 1_500, 3_000, 1)],
      [cue("r1", 0, 2_200, 0), cue("r2", 1_800, 3_000, 1)],
    );
    const accepted = acceptAlignmentGroup(draft, draft.groups[0].id);

    expect(accepted.groups[0]).toMatchObject({
      sourceCueIds: ["s1", "s2"],
      referenceCueIds: ["r1", "r2"],
      decision: "accepted",
    });
    expect(isSubtitleDraftReady(accepted)).toBe(true);
  });

  it("splits a multi-source group into ordered pending groups and returns references to the tray", () => {
    const draft = draftFrom(
      [cue("s1", 0, 2_000, 0), cue("s2", 1_500, 3_000, 1)],
      [cue("r1", 0, 2_200, 0)],
    );
    const split = splitSourceGroup(draft, draft.groups[0].id);

    expect(split.groups).toMatchObject([
      { sourceCueIds: ["s1"], referenceCueIds: [], decision: "pending" },
      { sourceCueIds: ["s2"], referenceCueIds: [], decision: "pending" },
    ]);
    expect(split.unassignedReferenceCueIds).toEqual(["r1"]);
  });

  it("reattaches multiple references in their subtitle order and rejects duplicate assignment", () => {
    const draft = draftFrom(
      [cue("s1", 0, 1_000, 0)],
      [cue("r2", 3_000, 4_000, 1), cue("r1", 2_000, 3_000, 0)],
    );
    const attached = attachReferences(draft, draft.groups[0].id, ["r2", "r1"]);

    expect(attached.groups[0].referenceCueIds).toEqual(["r1", "r2"]);
    expect(() =>
      attachReferences(attached, attached.groups[0].id, ["r1"]),
    ).toThrow("not available in the unassigned reference tray");
  });

  it("retains ignored cue IDs as explicit conservation outcomes", () => {
    const draft = draftWithUnassignedReference();
    const ignored = ignoreReference(draft, "r1");

    expect(ignored.ignoredReferenceCueIds).toEqual(["r1"]);
    expect(ignored.unassignedReferenceCueIds).toEqual([]);
    expect(validateCueConservation(ignored)).toEqual({ kind: "valid" });
  });

  it("blocks readiness when decode or parse failures remain", () => {
    const failure: SubtitleProcessingFailure = {
      kind: "processing-error",
      role: "source",
      code: "invalid-encoding",
      retryable: true,
      message: "The file is not valid utf-8.",
    };
    const draft = draftFrom([cue("s1", 0, 1_000, 0)], [], [failure]);

    expect(
      isSubtitleDraftReady(keepSourceOnly(draft, draft.groups[0].id)),
    ).toBe(false);
  });

  it("creates ordered review lines with content, provenance, timing, and deduplicated speakers", () => {
    const draft = draftFrom(
      [cue("s2", 2_000, 3_000, 1, "Mika"), cue("s1", 0, 1_000, 0, "Haru")],
      [cue("r1", 0, 3_000, 0)],
    );
    const ready = acceptAlignmentGroup(draft, draft.groups[0].id);

    expect(createReviewLinesFromSubtitleDraft(ready)).toEqual([
      {
        id: "line-1",
        source: "text:s1\ntext:s2",
        reference: "text:r1",
        subtitle: {
          sourceCueIds: ["s1", "s2"],
          referenceCueIds: ["r1"],
          startMs: 0,
          endMs: 3_000,
          speakers: ["Haru", "Mika"],
        },
      },
    ]);
  });

  it("refuses to create review lines from an unresolved draft", () => {
    const draft = draftWithUnassignedReference();

    expect(() => createReviewLinesFromSubtitleDraft(draft)).toThrow(
      "Subtitle alignment is not ready for review.",
    );
  });

  it("rejects empty drafts, duplicate group IDs, and duplicate cue IDs at the runtime boundary", () => {
    const ready = keepSourceOnly(
      draftFrom([cue("s1", 0, 1_000, 0)]),
      "alignment-group-1",
    );

    expect(
      subtitleImportDraftSchema.safeParse({
        ...ready,
        sourceCues: [],
        groups: [],
        activeGroupId: null,
      }).success,
    ).toBe(false);
    expect(
      subtitleImportDraftSchema.safeParse({
        ...ready,
        groups: [...ready.groups, ...ready.groups],
      }).success,
    ).toBe(false);
    expect(
      subtitleImportDraftSchema.safeParse({
        ...ready,
        referenceCues: [cue("s1", 2_000, 3_000, 0)],
      }).success,
    ).toBe(false);
  });

  it("rejects incoherent decision, status, and reference combinations before readiness", () => {
    const ready = keepSourceOnly(
      draftFrom([cue("s1", 0, 1_000, 0)]),
      "alignment-group-1",
    );
    const incoherent = {
      ...ready,
      groups: [
        {
          ...ready.groups[0],
          decision: "automatic",
          confidence: 80,
        },
      ],
    } as unknown as SubtitleImportDraft;

    expect(subtitleImportDraftSchema.safeParse(incoherent).success).toBe(false);
    expect(isSubtitleDraftReady(incoherent)).toBe(false);
  });

  it("rejects invalid conservation before edits and validates generated split groups after edits", () => {
    const invalidBeforeEdit = {
      ...draftFrom([cue("s1", 0, 1_000, 0), cue("s2", 2_000, 3_000, 1)]),
      groups: [
        {
          id: "alignment-group-1",
          sourceCueIds: ["s1"],
          referenceCueIds: [],
          status: "source-only",
          confidence: null,
          decision: "source-only",
        },
        {
          id: "alignment-group-2",
          sourceCueIds: ["s1"],
          referenceCueIds: [],
          status: "source-only",
          confidence: null,
          decision: "source-only",
        },
      ],
    } as unknown as SubtitleImportDraft;
    expect(validateCueConservation(invalidBeforeEdit)).toMatchObject({
      kind: "invalid",
    });
    expect(() =>
      keepSourceOnly(invalidBeforeEdit, "alignment-group-1"),
    ).toThrow("Subtitle cue conservation is invalid");

    const validBeforeSplit = {
      ...draftFrom(
        [
          cue("s1", 0, 1_000, 0),
          cue("s2", 1_000, 2_000, 1),
          cue("s3", 2_000, 3_000, 2),
        ],
        [cue("r1", 0, 2_000, 0)],
      ),
      groups: [
        {
          id: "group",
          sourceCueIds: ["s1", "s2"],
          referenceCueIds: ["r1"],
          status: "needs-review",
          confidence: 90,
          decision: "accepted",
        },
        {
          id: "group:split:1",
          sourceCueIds: ["s3"],
          referenceCueIds: [],
          status: "source-only",
          confidence: null,
          decision: "source-only",
        },
      ],
      unassignedReferenceCueIds: [],
      ignoredReferenceCueIds: [],
      activeGroupId: "group",
    } as unknown as SubtitleImportDraft;
    expect(validateCueConservation(validBeforeSplit)).toEqual({
      kind: "valid",
    });
    expect(() => splitSourceGroup(validBeforeSplit, "group")).toThrow();
  });

  it("invalidates automatic confidence when membership is manually attached or detached", () => {
    const draft = draftFrom(
      [cue("s1", 0, 4_000, 0)],
      [cue("r1", 0, 4_000, 0), cue("r2", 5_000, 6_000, 1)],
    );
    const attached = attachReferences(draft, draft.groups[0].id, ["r2"]);
    const detached = detachReferences(attached, attached.groups[0].id, ["r1"]);

    expect(draft.groups[0]).toMatchObject({
      status: "confident",
      confidence: 100,
    });
    expect(attached.groups[0]).toMatchObject({
      status: "needs-review",
      confidence: null,
      decision: "accepted",
    });
    expect(detached.groups[0]).toMatchObject({
      status: "needs-review",
      confidence: null,
      decision: "pending",
    });
  });
});

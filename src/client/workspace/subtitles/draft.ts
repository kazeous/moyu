import { z } from "zod";
import { alignSubtitleCues } from "./alignment";
import {
  type AlignmentGroup,
  subtitleCueSchema,
  subtitleImportDraftSchema,
  subtitleProcessingFailureSchema,
  type SubtitleCue,
  type SubtitleImportDraft,
} from "./contracts";

const createSubtitleImportDraftInputSchema = z
  .object({
    id: z.string().min(1),
    sourceArtifactId: z.string().min(1),
    referenceArtifactId: z.string().min(1).optional(),
    sourceLanguage: z.enum(["ja", "zh"]),
    referenceLanguage: z.enum(["en", "vi"]),
    sourceCues: z.array(subtitleCueSchema),
    referenceCues: z.array(subtitleCueSchema).default([]),
    blockingFailures: z.array(subtitleProcessingFailureSchema).default([]),
  })
  .strict();

export type CreateSubtitleImportDraftInput = Readonly<{
  id: string;
  sourceArtifactId: string;
  referenceArtifactId?: string;
  sourceLanguage: "ja" | "zh";
  referenceLanguage: "en" | "vi";
  sourceCues: readonly SubtitleCue[];
  referenceCues?: readonly SubtitleCue[];
  blockingFailures?: readonly z.infer<typeof subtitleProcessingFailureSchema>[];
}>;

export type CueConservationValidation =
  Readonly<{ kind: "valid" }> | Readonly<{ kind: "invalid"; reason: string }>;

export type SubtitleDraftReviewLine = Readonly<{
  id: string;
  source: string;
  reference?: string;
  subtitle: Readonly<{
    sourceCueIds: readonly string[];
    referenceCueIds: readonly string[];
    startMs: number | null;
    endMs: number | null;
    speakers: readonly string[];
  }>;
}>;

function parseDraft(value: unknown): SubtitleImportDraft {
  return subtitleImportDraftSchema.parse(
    value,
  ) as unknown as SubtitleImportDraft;
}

function requireConserved(value: unknown): SubtitleImportDraft {
  const draft = parseDraft(value);
  const validation = validateCueConservation(draft);
  if (validation.kind === "invalid") {
    throw new Error(
      `Subtitle cue conservation is invalid: ${validation.reason}`,
    );
  }
  return draft;
}

function orderedCues(cues: readonly SubtitleCue[]) {
  return [...cues].sort(
    (left, right) =>
      left.sourceOrder - right.sourceOrder || left.id.localeCompare(right.id),
  );
}

function requireGroup(draft: SubtitleImportDraft, groupId: string) {
  const group = draft.groups.find((candidate) => candidate.id === groupId);
  if (group === undefined)
    throw new Error(`Unknown alignment group ${groupId}.`);
  return group;
}

function requireUnassignedReferences(
  draft: SubtitleImportDraft,
  referenceCueIds: readonly string[],
) {
  if (referenceCueIds.length === 0)
    throw new Error("At least one reference cue is required.");
  if (new Set(referenceCueIds).size !== referenceCueIds.length) {
    throw new Error("A reference cue can only be assigned once.");
  }
  const referenceIds = new Set(draft.referenceCues.map((cue) => cue.id));
  for (const referenceCueId of referenceCueIds) {
    if (!referenceIds.has(referenceCueId))
      throw new Error(`Unknown reference cue ${referenceCueId}.`);
    if (!draft.unassignedReferenceCueIds.includes(referenceCueId)) {
      throw new Error(
        `Reference cue ${referenceCueId} is not available in the unassigned reference tray.`,
      );
    }
  }
}

function orderedReferenceIds(
  draft: SubtitleImportDraft,
  ids: readonly string[],
) {
  const cueById = new Map(draft.referenceCues.map((cue) => [cue.id, cue]));
  return [...ids].sort((left, right) => {
    const leftCue = cueById.get(left);
    const rightCue = cueById.get(right);
    if (leftCue === undefined || rightCue === undefined)
      return left.localeCompare(right);
    return (
      leftCue.sourceOrder - rightCue.sourceOrder ||
      leftCue.id.localeCompare(rightCue.id)
    );
  });
}

function updateGroup(
  draft: SubtitleImportDraft,
  groupId: string,
  replacement: AlignmentGroup | readonly AlignmentGroup[],
  changes: Partial<
    Pick<
      SubtitleImportDraft,
      "unassignedReferenceCueIds" | "ignoredReferenceCueIds" | "activeGroupId"
    >
  > = {},
) {
  const current = requireConserved(draft);
  requireGroup(current, groupId);
  const replacements = Array.isArray(replacement) ? replacement : [replacement];
  const groups = current.groups.flatMap((group) =>
    group.id === groupId ? replacements : [group],
  );
  return requireConserved({ ...current, ...changes, groups });
}

export function createSubtitleImportDraft(
  input: CreateSubtitleImportDraftInput,
): SubtitleImportDraft {
  const parsed = createSubtitleImportDraftInputSchema.parse(input);
  if (parsed.sourceCues.length === 0)
    throw new Error(
      "A subtitle import draft requires at least one source cue.",
    );
  const allIds = [...parsed.sourceCues, ...parsed.referenceCues].map(
    (cue) => cue.id,
  );
  if (new Set(allIds).size !== allIds.length)
    throw new Error("Subtitle cue identifiers must be unique.");

  const proposal = alignSubtitleCues(parsed.sourceCues, parsed.referenceCues);
  return requireConserved({
    version: 1,
    id: parsed.id,
    sourceArtifactId: parsed.sourceArtifactId,
    ...(parsed.referenceArtifactId === undefined
      ? {}
      : { referenceArtifactId: parsed.referenceArtifactId }),
    sourceLanguage: parsed.sourceLanguage,
    referenceLanguage: parsed.referenceLanguage,
    sourceCues: parsed.sourceCues,
    referenceCues: parsed.referenceCues,
    groups: proposal.groups,
    unassignedReferenceCueIds: proposal.unassignedReferenceCueIds,
    ignoredReferenceCueIds: [],
    activeGroupId: proposal.groups[0]?.id ?? null,
    blockingFailures: parsed.blockingFailures,
  });
}

export function acceptAlignmentGroup(
  draft: SubtitleImportDraft,
  groupId: string,
): SubtitleImportDraft {
  const parsed = requireConserved(draft);
  const group = requireGroup(parsed, groupId);
  if (group.referenceCueIds.length === 0) {
    throw new Error(
      "A source group without references must be kept source-only.",
    );
  }
  return updateGroup(parsed, groupId, { ...group, decision: "accepted" });
}

export function attachReferences(
  draft: SubtitleImportDraft,
  groupId: string,
  referenceCueIds: readonly string[],
): SubtitleImportDraft {
  const parsed = requireConserved(draft);
  const group = requireGroup(parsed, groupId);
  requireUnassignedReferences(parsed, referenceCueIds);
  const attached = orderedReferenceIds(parsed, [
    ...group.referenceCueIds,
    ...referenceCueIds,
  ]);
  return updateGroup(
    parsed,
    groupId,
    {
      ...group,
      referenceCueIds: attached,
      status: "needs-review",
      confidence: null,
      decision: "accepted",
    },
    {
      unassignedReferenceCueIds: parsed.unassignedReferenceCueIds.filter(
        (referenceCueId) => !referenceCueIds.includes(referenceCueId),
      ),
    },
  );
}

export function detachReferences(
  draft: SubtitleImportDraft,
  groupId: string,
  referenceCueIds: readonly string[],
): SubtitleImportDraft {
  const parsed = requireConserved(draft);
  const group = requireGroup(parsed, groupId);
  if (referenceCueIds.length === 0)
    throw new Error("At least one attached reference cue is required.");
  if (new Set(referenceCueIds).size !== referenceCueIds.length) {
    throw new Error("A reference cue can only be detached once.");
  }
  for (const referenceCueId of referenceCueIds) {
    if (!group.referenceCueIds.includes(referenceCueId)) {
      throw new Error(
        `Reference cue ${referenceCueId} is not attached to alignment group ${groupId}.`,
      );
    }
  }
  const remaining = group.referenceCueIds.filter(
    (referenceCueId) => !referenceCueIds.includes(referenceCueId),
  );
  return updateGroup(
    parsed,
    groupId,
    {
      ...group,
      referenceCueIds: remaining,
      status: remaining.length === 0 ? "source-only" : "needs-review",
      confidence: null,
      decision: "pending",
    },
    {
      unassignedReferenceCueIds: orderedReferenceIds(parsed, [
        ...parsed.unassignedReferenceCueIds,
        ...referenceCueIds,
      ]),
    },
  );
}

export function splitSourceGroup(
  draft: SubtitleImportDraft,
  groupId: string,
): SubtitleImportDraft {
  const parsed = requireConserved(draft);
  const group = requireGroup(parsed, groupId);
  if (group.sourceCueIds.length < 2)
    throw new Error("Only multi-source alignment groups can be split.");
  const sourceById = new Map(parsed.sourceCues.map((cue) => [cue.id, cue]));
  const splitGroups = orderedCues(
    group.sourceCueIds.map((id) => {
      const cue = sourceById.get(id);
      if (cue === undefined) throw new Error(`Unknown source cue ${id}.`);
      return cue;
    }),
  ).map((sourceCue, index) => ({
    id: `${group.id}:split:${index + 1}`,
    sourceCueIds: [sourceCue.id] as [string, ...string[]],
    referenceCueIds: [],
    status: "source-only" as const,
    confidence: null,
    decision: "pending" as const,
  }));
  return updateGroup(parsed, groupId, splitGroups, {
    activeGroupId: splitGroups[0].id,
    unassignedReferenceCueIds: orderedReferenceIds(parsed, [
      ...parsed.unassignedReferenceCueIds,
      ...group.referenceCueIds,
    ]),
  });
}

export function keepSourceOnly(
  draft: SubtitleImportDraft,
  groupId: string,
): SubtitleImportDraft {
  const parsed = requireConserved(draft);
  const group = requireGroup(parsed, groupId);
  return updateGroup(
    parsed,
    groupId,
    {
      ...group,
      referenceCueIds: [],
      status: "source-only",
      confidence: null,
      decision: "source-only",
    },
    {
      unassignedReferenceCueIds: orderedReferenceIds(parsed, [
        ...parsed.unassignedReferenceCueIds,
        ...group.referenceCueIds,
      ]),
    },
  );
}

export function ignoreReference(
  draft: SubtitleImportDraft,
  referenceCueId: string,
): SubtitleImportDraft {
  const parsed = requireConserved(draft);
  if (!parsed.unassignedReferenceCueIds.includes(referenceCueId)) {
    throw new Error(
      `Reference cue ${referenceCueId} is not available in the unassigned reference tray.`,
    );
  }
  return requireConserved({
    ...parsed,
    unassignedReferenceCueIds: parsed.unassignedReferenceCueIds.filter(
      (id) => id !== referenceCueId,
    ),
    ignoredReferenceCueIds: orderedReferenceIds(parsed, [
      ...parsed.ignoredReferenceCueIds,
      referenceCueId,
    ]),
  });
}

export function validateCueConservation(
  value: unknown,
): CueConservationValidation {
  const parsed = subtitleImportDraftSchema.safeParse(value);
  if (!parsed.success)
    return {
      kind: "invalid",
      reason: "Draft does not match the subtitle import schema.",
    };
  const draft = parsed.data as unknown as SubtitleImportDraft;
  const sourceIds = draft.sourceCues.map((cue) => cue.id);
  const referenceIds = draft.referenceCues.map((cue) => cue.id);
  if (
    new Set(sourceIds).size !== sourceIds.length ||
    new Set(referenceIds).size !== referenceIds.length
  ) {
    return {
      kind: "invalid",
      reason: "Subtitle cue identifiers must be unique.",
    };
  }

  const occurrences = new Map<string, number>();
  for (const group of draft.groups) {
    for (const sourceCueId of group.sourceCueIds) {
      occurrences.set(sourceCueId, (occurrences.get(sourceCueId) ?? 0) + 1);
    }
  }
  for (const sourceCueId of sourceIds) {
    if (occurrences.get(sourceCueId) !== 1) {
      return {
        kind: "invalid",
        reason: `Source cue ${sourceCueId} must occur in exactly one group.`,
      };
    }
  }
  if (
    [...occurrences.keys()].some(
      (sourceCueId) => !sourceIds.includes(sourceCueId),
    )
  ) {
    return {
      kind: "invalid",
      reason: "A group contains an unknown source cue.",
    };
  }

  const referenceOccurrences = new Map<string, number>();
  const recordReferences = (ids: readonly string[]) => {
    for (const referenceCueId of ids) {
      referenceOccurrences.set(
        referenceCueId,
        (referenceOccurrences.get(referenceCueId) ?? 0) + 1,
      );
    }
  };
  for (const group of draft.groups) recordReferences(group.referenceCueIds);
  recordReferences(draft.unassignedReferenceCueIds);
  recordReferences(draft.ignoredReferenceCueIds);
  for (const referenceCueId of referenceIds) {
    if (referenceOccurrences.get(referenceCueId) !== 1) {
      return {
        kind: "invalid",
        reason: `Reference cue ${referenceCueId} must have exactly one explicit outcome.`,
      };
    }
  }
  if (
    [...referenceOccurrences.keys()].some(
      (referenceCueId) => !referenceIds.includes(referenceCueId),
    )
  ) {
    return {
      kind: "invalid",
      reason: "Draft contains an unknown reference cue.",
    };
  }
  return { kind: "valid" };
}

export function isSubtitleDraftReady(draft: SubtitleImportDraft) {
  return (
    validateCueConservation(draft).kind === "valid" &&
    draft.groups.every((group) => group.decision !== "pending") &&
    draft.unassignedReferenceCueIds.length === 0 &&
    draft.blockingFailures.length === 0
  );
}

function groupTimeSpan(sourceCues: readonly SubtitleCue[]) {
  if (sourceCues.some((cue) => cue.startMs === null || cue.endMs === null)) {
    return { startMs: null, endMs: null };
  }
  return {
    startMs: Math.min(...sourceCues.map((cue) => cue.startMs as number)),
    endMs: Math.max(...sourceCues.map((cue) => cue.endMs as number)),
  };
}

export function createReviewLinesFromSubtitleDraft(
  draft: SubtitleImportDraft,
): readonly SubtitleDraftReviewLine[] {
  const parsed = requireConserved(draft);
  if (!isSubtitleDraftReady(parsed))
    throw new Error("Subtitle alignment is not ready for review.");
  const sourceById = new Map(parsed.sourceCues.map((cue) => [cue.id, cue]));
  const referenceById = new Map(
    parsed.referenceCues.map((cue) => [cue.id, cue]),
  );
  const groups = [...parsed.groups].sort((left, right) => {
    const leftCue = sourceById.get(left.sourceCueIds[0]);
    const rightCue = sourceById.get(right.sourceCueIds[0]);
    return (
      (leftCue?.sourceOrder ?? 0) - (rightCue?.sourceOrder ?? 0) ||
      left.id.localeCompare(right.id)
    );
  });

  return groups.map((group, index) => {
    const sourceCues = orderedCues(
      group.sourceCueIds.map((id) => {
        const cue = sourceById.get(id);
        if (cue === undefined) throw new Error(`Unknown source cue ${id}.`);
        return cue;
      }),
    );
    const referenceCues = orderedCues(
      group.referenceCueIds.map((id) => {
        const cue = referenceById.get(id);
        if (cue === undefined) throw new Error(`Unknown reference cue ${id}.`);
        return cue;
      }),
    );
    const speakers = [
      ...new Set(
        sourceCues.flatMap((cue) =>
          cue.speaker === undefined || cue.speaker === "" ? [] : [cue.speaker],
        ),
      ),
    ];
    const timeSpan = groupTimeSpan(sourceCues);
    return {
      id: `line-${index + 1}`,
      source: sourceCues.map((cue) => cue.visibleText).join("\n"),
      ...(referenceCues.length === 0
        ? {}
        : {
            reference: referenceCues.map((cue) => cue.visibleText).join("\n"),
          }),
      subtitle: {
        sourceCueIds: sourceCues.map((cue) => cue.id),
        referenceCueIds: referenceCues.map((cue) => cue.id),
        ...timeSpan,
        speakers,
      },
    };
  });
}

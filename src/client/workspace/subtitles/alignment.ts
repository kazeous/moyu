import {
  type AlignmentDecision,
  type AlignmentGroup,
  type SubtitleCue,
} from "./contracts";

const CONFIDENT_SCORE = 80;

type Interval = Readonly<{ startMs: number; endMs: number }>;

export type AlignmentProposal = Readonly<{
  groups: readonly AlignmentGroup[];
  unassignedReferenceCueIds: readonly string[];
}>;

function intervalFor(cue: SubtitleCue): Interval | null {
  if (
    cue.startMs === null ||
    cue.endMs === null ||
    !Number.isFinite(cue.startMs) ||
    !Number.isFinite(cue.endMs) ||
    cue.startMs < 0 ||
    cue.endMs <= cue.startMs
  ) {
    return null;
  }

  return { startMs: cue.startMs, endMs: cue.endMs };
}

function duration(interval: Interval) {
  return interval.endMs - interval.startMs;
}

function midpoint(interval: Interval) {
  return (interval.startMs + interval.endMs) / 2;
}

function overlapDuration(a: Interval, b: Interval) {
  return Math.max(
    0,
    Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs),
  );
}

function timingScore(coverage: number, midpointProximity: number) {
  return Math.round(100 * (0.8 * coverage + 0.2 * midpointProximity));
}

function ordered(cues: readonly SubtitleCue[]) {
  return [...cues].sort(
    (left, right) =>
      left.sourceOrder - right.sourceOrder || left.id.localeCompare(right.id),
  );
}

function weightedMidpoint(cues: readonly SubtitleCue[]) {
  let totalDuration = 0;
  let weightedSum = 0;

  for (const cue of cues) {
    const interval = intervalFor(cue);
    if (interval === null) return null;
    const cueDuration = duration(interval);
    totalDuration += cueDuration;
    weightedSum += midpoint(interval) * cueDuration;
  }

  return totalDuration === 0 ? null : weightedSum / totalDuration;
}

function summedDuration(cues: readonly SubtitleCue[]) {
  let total = 0;
  for (const cue of cues) {
    const interval = intervalFor(cue);
    if (interval === null) return null;
    total += duration(interval);
  }
  return total;
}

export function scoreTimingGroup(
  sourceCues: readonly SubtitleCue[],
  referenceCues: readonly SubtitleCue[],
): number | null {
  if (sourceCues.length === 0 || referenceCues.length === 0) return null;

  const sourceDuration = summedDuration(sourceCues);
  const referenceDuration = summedDuration(referenceCues);
  const sourceMidpoint = weightedMidpoint(sourceCues);
  const referenceMidpoint = weightedMidpoint(referenceCues);
  if (
    sourceDuration === null ||
    referenceDuration === null ||
    sourceMidpoint === null ||
    referenceMidpoint === null
  ) {
    return null;
  }

  let overlap = 0;
  for (const sourceCue of sourceCues) {
    const sourceInterval = intervalFor(sourceCue);
    if (sourceInterval === null) return null;
    for (const referenceCue of referenceCues) {
      const referenceInterval = intervalFor(referenceCue);
      if (referenceInterval === null) return null;
      overlap += overlapDuration(sourceInterval, referenceInterval);
    }
  }

  const coverage = Math.min(
    1,
    Math.max(0, overlap / Math.min(sourceDuration, referenceDuration)),
  );
  const midpointProximity = Math.max(
    0,
    1 -
      Math.abs(sourceMidpoint - referenceMidpoint) /
        Math.max(sourceDuration, referenceDuration, 1_000),
  );
  return timingScore(coverage, midpointProximity);
}

function areConsecutive(cues: readonly SubtitleCue[]) {
  const sorted = ordered(cues);
  return sorted.every(
    (cue, index) =>
      index === 0 || cue.sourceOrder === sorted[index - 1].sourceOrder + 1,
  );
}

function groupId(index: number) {
  return `alignment-group-${index + 1}`;
}

function createGroup(
  id: string,
  sourceCues: readonly SubtitleCue[],
  referenceCues: readonly SubtitleCue[],
): AlignmentGroup {
  const source = ordered(sourceCues);
  const reference = ordered(referenceCues);
  const score = scoreTimingGroup(source, reference);
  const eligibleCardinality =
    (source.length === 1 && reference.length >= 1) ||
    (reference.length === 1 && source.length >= 1);
  const multiCueSide = source.length > 1 ? source : reference;
  const confident =
    reference.length > 0 &&
    eligibleCardinality &&
    areConsecutive(multiCueSide) &&
    score !== null &&
    score >= CONFIDENT_SCORE;
  const decision: AlignmentDecision = confident ? "automatic" : "pending";

  return {
    id,
    sourceCueIds: source.map((cue) => cue.id) as [string, ...string[]],
    referenceCueIds: reference.map((cue) => cue.id),
    status: confident
      ? "confident"
      : reference.length === 0
        ? "source-only"
        : "needs-review",
    confidence: score,
    decision,
  };
}

export function alignSubtitleCues(
  sourceCues: readonly SubtitleCue[],
  referenceCues: readonly SubtitleCue[],
): AlignmentProposal {
  const source = ordered(sourceCues);
  const reference = ordered(referenceCues);
  const sourceById = new Map(source.map((cue) => [cue.id, cue]));
  const edges = new Map<string, Set<string>>();

  for (const sourceCue of source) {
    const sourceInterval = intervalFor(sourceCue);
    if (sourceInterval === null) continue;
    for (const referenceCue of reference) {
      const referenceInterval = intervalFor(referenceCue);
      if (
        referenceInterval === null ||
        overlapDuration(sourceInterval, referenceInterval) === 0
      )
        continue;
      (
        edges.get(sourceCue.id) ??
        edges.set(sourceCue.id, new Set()).get(sourceCue.id)!
      ).add(referenceCue.id);
    }
  }

  const seenSources = new Set<string>();
  const seenReferences = new Set<string>();
  const groups: AlignmentGroup[] = [];
  const connectedSourceIds = new Set(edges.keys());

  for (const startSource of source) {
    if (
      !connectedSourceIds.has(startSource.id) ||
      seenSources.has(startSource.id)
    )
      continue;
    const componentSources = new Set<string>();
    const componentReferences = new Set<string>();
    const queue: Array<{ kind: "source" | "reference"; id: string }> = [
      { kind: "source", id: startSource.id },
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      if (current.kind === "source") {
        if (seenSources.has(current.id)) continue;
        seenSources.add(current.id);
        componentSources.add(current.id);
        for (const referenceId of edges.get(current.id) ?? [])
          queue.push({ kind: "reference", id: referenceId });
      } else {
        if (seenReferences.has(current.id)) continue;
        seenReferences.add(current.id);
        componentReferences.add(current.id);
        for (const [sourceId, referenceIds] of edges) {
          if (referenceIds.has(current.id))
            queue.push({ kind: "source", id: sourceId });
        }
      }
    }

    groups.push(
      createGroup(
        groupId(groups.length),
        source.filter((cue) => componentSources.has(cue.id)),
        reference.filter((cue) => componentReferences.has(cue.id)),
      ),
    );
  }

  for (const sourceCue of source) {
    if (seenSources.has(sourceCue.id)) continue;
    groups.push(createGroup(groupId(groups.length), [sourceCue], []));
  }

  groups.sort((left, right) => {
    const leftCue = sourceById.get(left.sourceCueIds[0]);
    const rightCue = sourceById.get(right.sourceCueIds[0]);
    return (
      (leftCue?.sourceOrder ?? 0) - (rightCue?.sourceOrder ?? 0) ||
      left.id.localeCompare(right.id)
    );
  });

  return {
    groups: groups.map((group, index) => ({ ...group, id: groupId(index) })),
    unassignedReferenceCueIds: reference
      .filter((cue) => !seenReferences.has(cue.id))
      .map((cue) => cue.id),
  };
}

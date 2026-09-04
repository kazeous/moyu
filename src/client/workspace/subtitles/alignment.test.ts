import { describe, expect, it } from "vitest";
import { alignSubtitleCues, scoreTimingGroup } from "./alignment";
import type { SubtitleCue } from "./contracts";

function cue(
  id: string,
  startMs: number | null,
  endMs: number | null,
  sourceOrder: number,
): SubtitleCue {
  return {
    id,
    artifactId: id.startsWith("s") ? "source" : "reference",
    sourceOrder,
    startMs,
    endMs,
    rawPayload: id,
    visibleText: id,
    warnings: [],
  };
}

describe("alignSubtitleCues", () => {
  it("scores a contained one-to-one match as confident", () => {
    const proposal = alignSubtitleCues(
      [cue("s1", 0, 2_000, 0)],
      [cue("r1", 200, 1_800, 0)],
    );

    expect(proposal.groups).toMatchObject([
      {
        sourceCueIds: ["s1"],
        referenceCueIds: ["r1"],
        status: "confident",
        decision: "automatic",
      },
    ]);
  });

  it("forms a confident one-to-many component only from consecutive cues", () => {
    const proposal = alignSubtitleCues(
      [cue("s1", 0, 4_000, 0)],
      [cue("r1", 0, 1_800, 0), cue("r2", 2_000, 4_000, 1)],
    );

    expect(proposal.groups[0]).toMatchObject({
      sourceCueIds: ["s1"],
      referenceCueIds: ["r1", "r2"],
      status: "confident",
      decision: "automatic",
    });
  });

  it("forms a confident many-to-one component only from consecutive cues", () => {
    const proposal = alignSubtitleCues(
      [cue("s1", 0, 1_800, 0), cue("s2", 2_000, 4_000, 1)],
      [cue("r1", 0, 4_000, 0)],
    );

    expect(proposal.groups[0]).toMatchObject({
      sourceCueIds: ["s1", "s2"],
      referenceCueIds: ["r1"],
      status: "confident",
      decision: "automatic",
    });
  });

  it("flags a many-to-many component instead of choosing semantics", () => {
    const proposal = alignSubtitleCues(
      [cue("s1", 0, 2_000, 0), cue("s2", 1_500, 3_000, 1)],
      [cue("r1", 0, 2_200, 0), cue("r2", 1_800, 3_000, 1)],
    );

    expect(proposal.groups[0]).toMatchObject({
      status: "needs-review",
      decision: "pending",
    });
  });

  it("leaves non-overlapping cues unmatched even when midpoints are nearby", () => {
    const proposal = alignSubtitleCues(
      [cue("s1", 0, 1_000, 0)],
      [cue("r1", 1_001, 2_000, 0)],
    );

    expect(proposal.groups[0]).toMatchObject({
      sourceCueIds: ["s1"],
      referenceCueIds: [],
      decision: "pending",
    });
    expect(proposal.unassignedReferenceCueIds).toEqual(["r1"]);
  });

  it("uses the accepted 80/20 timing score at the confidence boundary", () => {
    expect(
      scoreTimingGroup([cue("s1", 0, 1_000, 0)], [cue("r1", 200, 1_200, 0)]),
    ).toBe(80);
    expect(
      scoreTimingGroup([cue("s1", 0, 1_000, 0)], [cue("r1", 210, 1_210, 0)]),
    ).toBe(79);
  });

  it("does not calculate scores or automatic edges for invalid timing", () => {
    const sources = [cue("s1", null, null, 0), cue("s2", 1_000, 1_000, 1)];
    const references = [cue("r1", 0, 1_000, 0), cue("r2", 1_000, 1_000, 1)];

    expect(scoreTimingGroup(sources, references)).toBeNull();
    expect(alignSubtitleCues(sources, references)).toMatchObject({
      groups: [
        { sourceCueIds: ["s1"], referenceCueIds: [], decision: "pending" },
        { sourceCueIds: ["s2"], referenceCueIds: [], decision: "pending" },
      ],
      unassignedReferenceCueIds: ["r1", "r2"],
    });
  });

  it("flags tied competing edges for review without dropping a cue", () => {
    const proposal = alignSubtitleCues(
      [cue("s1", 0, 1_000, 0), cue("s2", 0, 1_000, 1)],
      [cue("r1", 0, 1_000, 0), cue("r2", 0, 1_000, 1)],
    );

    expect(proposal.groups).toHaveLength(1);
    expect(proposal.groups[0]).toMatchObject({
      sourceCueIds: ["s1", "s2"],
      referenceCueIds: ["r1", "r2"],
      status: "needs-review",
      decision: "pending",
    });
  });

  it("uses source and reference order only to stabilize output", () => {
    const proposal = alignSubtitleCues(
      [cue("s2", 2_000, 3_000, 1), cue("s1", 0, 1_000, 0)],
      [cue("r2", 2_000, 3_000, 1), cue("r1", 0, 1_000, 0)],
    );

    expect(proposal.groups.map((group) => group.sourceCueIds)).toEqual([
      ["s1"],
      ["s2"],
    ]);
    expect(proposal.groups.map((group) => group.referenceCueIds)).toEqual([
      ["r1"],
      ["r2"],
    ]);
  });

  it("returns deep-equal proposals for repeated calls", () => {
    const source = [cue("s1", 0, 2_000, 0), cue("s2", 1_500, 3_000, 1)];
    const reference = [cue("r1", 0, 2_200, 0), cue("r2", 1_800, 3_000, 1)];

    expect(alignSubtitleCues(source, reference)).toEqual(
      alignSubtitleCues(source, reference),
    );
  });
});

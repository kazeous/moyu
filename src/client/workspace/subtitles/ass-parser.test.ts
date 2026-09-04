import { describe, expect, it } from "vitest";
import { parseAss } from "./ass-parser";

describe("parseAss", () => {
  it("uses declared Events columns and preserves commas in Text", () => {
    const result = parseAss({
      artifactId: "source-1",
      text: [
        "[Events]",
        "Format: Layer, End, Start, Actor, Text, Style",
        "Dialogue: 0,0:00:03.20,0:00:01.00,春樹,{\\pos(100,200)}待って, まだだ,Default",
      ].join("\n"),
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [
        {
          startMs: 1000,
          endMs: 3200,
          speaker: "春樹",
          visibleText: "待って, まだだ",
        },
      ],
    });
  });

  it("derives line breaks and removes style, position, and karaoke commands", () => {
    const result = parseAss({
      artifactId: "source-1",
      text: [
        "[Events]",
        "Format: Start, End, Name, Text",
        "Dialogue: 0:00:01.00,0:00:02.00,玲奈,{\\i1}一行目{\\i0}\\N{\\k20}二行目\\h続き",
      ].join("\n"),
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [{ speaker: "玲奈", visibleText: "一行目\n二行目 続き" }],
    });
  });

  it("returns a blocking error when Events has no usable Format", () => {
    expect(
      parseAss({ artifactId: "source-1", text: "[Events]\nDialogue: bad" }),
    ).toMatchObject({ kind: "parse-error", code: "missing-format" });
  });

  it("prefers Name over Actor and ignores Comment records without changing cue order", () => {
    const result = parseAss({
      artifactId: "source-1",
      text: [
        "[events]",
        "Format: Start, End, Actor, Name, Text",
        "Comment: 0:00:00.00,0:00:01.00,ignored,ignored,not a cue",
        "Dialogue: 0:00:02.00,0:00:03.00,Actor,Name,first",
        "Dialogue: 0:00:04.00,0:00:05.00,,,second, with commas",
      ].join("\r\n"),
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [
        { id: "source-1:cue:0", speaker: "Name", visibleText: "first" },
        {
          id: "source-1:cue:1",
          visibleText: "second, with commas",
        },
      ],
    });
    if (result.kind === "parsed") {
      expect(result.cues[1]).not.toHaveProperty("speaker");
    }
  });

  it("reports an incomplete declared format instead of guessing missing columns", () => {
    expect(
      parseAss({
        artifactId: "source-1",
        text: "[Events]\nFormat: Start, End, Actor\nDialogue: 0,1,a",
      }),
    ).toMatchObject({ kind: "parse-error", code: "missing-column" });
  });

  it("uses the most recent usable Format when a later declaration is incomplete", () => {
    expect(
      parseAss({
        artifactId: "source-1",
        text: [
          "[Events]",
          "Format: Start, End, Text",
          "Format: Layer, Start",
          "Dialogue: 0:00:01.00,0:00:02.00,retained",
        ].join("\n"),
      }),
    ).toMatchObject({
      kind: "parsed",
      cues: [{ startMs: 1000, endMs: 2000, visibleText: "retained" }],
    });
  });

  it("retains malformed Dialogue payloads with explicit warnings", () => {
    const result = parseAss({
      artifactId: "source-1",
      text: "[Events]\nFormat: Start, End, Text\nDialogue: 0:00:01.00",
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [
        {
          id: "source-1:cue:0",
          rawPayload: "Dialogue: 0:00:01.00",
          startMs: null,
          endMs: null,
          visibleText: "0:00:01.00",
        },
      ],
    });
    expect(JSON.stringify(result)).toContain("malformed-dialogue");
  });

  it("preserves suspicious unclosed override text with a warning", () => {
    const result = parseAss({
      artifactId: "source-1",
      text: "[Events]\nFormat: Start, End, Text\nDialogue: 0:00:01.00,0:00:02.00,{\\i1broken",
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [{ visibleText: "{\\i1broken" }],
    });
    expect(JSON.stringify(result)).toContain("suspicious-override");
  });
});

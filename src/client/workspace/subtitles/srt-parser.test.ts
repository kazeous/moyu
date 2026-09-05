import { describe, expect, it } from "vitest";
import { parseSubtitle } from "./parser";
import { parseSrt } from "./srt-parser";

describe("parseSrt", () => {
  it("preserves order and multiline text while removing presentation-only tags", () => {
    const result = parseSrt({
      artifactId: "source-1",
      text: [
        "7",
        "00:00:01,200 --> 00:00:03.450",
        "<i>第一行</i>",
        "第二行",
        "",
        "00:00:04,000 --> 00:00:05,000",
        '<font color="red">第三行</font>',
      ].join("\n"),
    });

    expect(result.kind).toBe("parsed");
    if (result.kind !== "parsed") return;
    expect(
      result.cues.map(({ sourceOrder, startMs, endMs, visibleText }) => ({
        sourceOrder,
        startMs,
        endMs,
        visibleText,
      })),
    ).toEqual([
      {
        sourceOrder: 0,
        startMs: 1200,
        endMs: 3450,
        visibleText: "第一行\n第二行",
      },
      { sourceOrder: 1, startMs: 4000, endMs: 5000, visibleText: "第三行" },
    ]);
  });

  it("retains malformed timing and unknown markup with warnings", () => {
    const result = parseSrt({
      artifactId: "source-1",
      text: "1\nnot-a-time --> still-not-a-time\n<ruby>原文</ruby>",
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [{ startMs: null, endMs: null, visibleText: "<ruby>原文</ruby>" }],
    });
    expect(JSON.stringify(result)).toContain("invalid-timestamp");
  });

  it("keeps exact CRLF payloads, optional indices, and blank visible lines", () => {
    const result = parseSrt({
      artifactId: "source-1",
      text: [
        "00:00:00,000 --> 00:00:01,000",
        "first line",
        "",
        "",
        "2",
        "00:00:02,000 --> 00:00:03,000",
        "second line",
      ].join("\r\n"),
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [
        {
          id: "source-1:cue:0",
          rawPayload: "00:00:00,000 --> 00:00:01,000\r\nfirst line\r\n",
          visibleText: "first line\n",
        },
        {
          id: "source-1:cue:1",
          rawPayload: "2\r\n00:00:02,000 --> 00:00:03,000\r\nsecond line",
          visibleText: "second line",
        },
      ],
    });
  });

  it("splits mixed line-ending blank separators without orphaning bytes", () => {
    const result = parseSrt({
      artifactId: "source-1",
      text: "00:00:00,000 --> 00:00:01,000\nfirst\n\r\n00:00:02,000 --> 00:00:03,000\r\nsecond",
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [
        {
          rawPayload: "00:00:00,000 --> 00:00:01,000\nfirst",
          visibleText: "first",
        },
        {
          rawPayload: "00:00:02,000 --> 00:00:03,000\r\nsecond",
          visibleText: "second",
        },
      ],
    });
  });

  it("retains every extra line ending in a long blank run", () => {
    const result = parseSrt({
      artifactId: "source-1",
      text: "00:00:00,000 --> 00:00:01,000\r\nfirst\r\n\n\r\n\r\n00:00:02,000 --> 00:00:03,000\r\nsecond",
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [
        {
          rawPayload: "00:00:00,000 --> 00:00:01,000\r\nfirst\r\n\n",
          visibleText: "first\n\n",
        },
        {
          rawPayload: "00:00:02,000 --> 00:00:03,000\r\nsecond",
          visibleText: "second",
        },
      ],
    });
  });

  it("keeps a non-numeric cue label visible and retains a terminal cue", () => {
    const result = parseSrt({
      artifactId: "source-1",
      text: "scene-A\n00:00:01,000 --> 00:00:02,000\n最後のキュー",
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [
        {
          startMs: 1000,
          endMs: 2000,
          visibleText: "scene-A\n最後のキュー",
        },
      ],
    });
  });

  it("preserves numeric dialogue text when it is not followed by a timestamp", () => {
    const result = parseSrt({
      artifactId: "source-1",
      text: "1984\nChapter title",
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [
        {
          startMs: null,
          endMs: null,
          visibleText: "1984\nChapter title",
        },
      ],
    });
    expect(JSON.stringify(result)).toContain("missing-timestamp");
  });

  it("keeps reversed ranges as nullable timing with an explicit warning", () => {
    const result = parseSrt({
      artifactId: "source-1",
      text: "00:00:03,000 --> 00:00:03,000\nzero length",
    });

    expect(result).toMatchObject({
      kind: "parsed",
      cues: [{ startMs: null, endMs: null, visibleText: "zero length" }],
    });
    expect(JSON.stringify(result)).toContain("invalid-timestamp");
  });

  it("dispatches each declared subtitle format to its parser", () => {
    expect(
      parseSubtitle({
        artifactId: "source-1",
        format: "srt",
        text: "00:00:00,000 --> 00:00:01,000\nSRT",
      }),
    ).toMatchObject({ kind: "parsed", cues: [{ visibleText: "SRT" }] });
    expect(
      parseSubtitle({
        artifactId: "source-1",
        format: "ass",
        text: "[Events]\nFormat: Start, End, Text\nDialogue: 0:00:00.00,0:00:01.00,ASS",
      }),
    ).toMatchObject({ kind: "parsed", cues: [{ visibleText: "ASS" }] });
  });
});

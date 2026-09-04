import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProcessSubtitleRequest,
  RequestedSubtitleEncoding,
  SubtitleFormat,
} from "./contracts";
import { createSubtitleProcessor, processSubtitleFiles } from "./processor";
import * as parser from "./parser";

afterEach(() => vi.restoreAllMocks());

const ASS_SOURCE = [
  "[Events]",
  "Format: Start, End, Name, Text",
  "Dialogue: 0:00:01.00,0:00:02.00,春樹,原文",
].join("\n");
const SRT_REFERENCE = "00:00:01,000 --> 00:00:02,000\nBản dịch";

function encodedInput(
  artifactId: string,
  format: SubtitleFormat,
  encoding: RequestedSubtitleEncoding,
  text: string,
) {
  return {
    artifactId,
    format,
    encoding,
    bytes: new TextEncoder().encode(text).buffer,
  };
}

function requestWithBytes(
  values: number[],
  encoding: RequestedSubtitleEncoding,
): ProcessSubtitleRequest {
  return {
    version: 1,
    operationId: "op-1",
    source: {
      artifactId: "source-artifact",
      format: "srt",
      encoding,
      bytes: new Uint8Array(values).buffer,
    },
    sourceLanguage: "zh",
    referenceLanguage: "vi",
  };
}

describe("processSubtitleFiles", () => {
  it("decodes, parses, and aligns mixed ASS source with SRT reference", () => {
    const result = processSubtitleFiles({
      version: 1,
      operationId: "op-1",
      source: encodedInput("source-artifact", "ass", "utf-8", ASS_SOURCE),
      reference: encodedInput(
        "reference-artifact",
        "srt",
        "utf-8",
        SRT_REFERENCE,
      ),
      sourceLanguage: "zh",
      referenceLanguage: "vi",
    });

    expect(result).toMatchObject({
      version: 1,
      operationId: "op-1",
      kind: "processed",
      draft: {
        id: "op-1",
        sourceArtifactId: "source-artifact",
        referenceArtifactId: "reference-artifact",
        groups: [{ decision: "automatic" }],
      },
    });
    if (result.kind === "processed") {
      expect(result.draft.sourceCues[0]?.id).toBe("source-artifact:cue:0");
      expect(result.draft.referenceCues[0]?.id).toBe(
        "reference-artifact:cue:0",
      );
      expect(JSON.stringify(result.draft)).not.toContain("原文:cue");
    }
  });

  it("returns an explicit retryable decode failure without partial replacement text", () => {
    const result = processSubtitleFiles(
      requestWithBytes([0x83, 0x65], "utf-8"),
    );

    expect(result).toMatchObject({
      kind: "processing-error",
      role: "source",
      code: "invalid-encoding",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("�");
  });

  it("creates pending source-only groups when no reference is supplied", () => {
    const result = processSubtitleFiles({
      version: 1,
      operationId: "source-only",
      source: encodedInput("source-artifact", "ass", "utf-8", ASS_SOURCE),
      sourceLanguage: "zh",
      referenceLanguage: "vi",
    });

    expect(result).toMatchObject({
      kind: "processed",
      draft: {
        referenceCues: [],
        groups: [{ status: "source-only", decision: "pending" }],
      },
    });
  });

  it("returns a content-free reference parse failure", () => {
    const result = processSubtitleFiles({
      version: 1,
      operationId: "bad-reference",
      source: encodedInput("source-artifact", "ass", "utf-8", ASS_SOURCE),
      reference: encodedInput(
        "reference-artifact",
        "ass",
        "utf-8",
        "[Events]\nDialogue: private reference content",
      ),
      sourceLanguage: "zh",
      referenceLanguage: "vi",
    });

    expect(result).toMatchObject({
      kind: "processing-error",
      role: "reference",
      code: "missing-format",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("private reference content");
  });

  it("uses each file's requested encoding independently", () => {
    const shiftJisReference = new Uint8Array([
      0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x2c, 0x30, 0x30, 0x30,
      0x20, 0x2d, 0x2d, 0x3e, 0x20, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30,
      0x32, 0x2c, 0x30, 0x30, 0x30, 0x0a, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67,
    ]).buffer;
    const result = processSubtitleFiles({
      version: 1,
      operationId: "independent-encodings",
      source: encodedInput("source-artifact", "ass", "utf-8", ASS_SOURCE),
      reference: {
        artifactId: "reference-artifact",
        format: "srt",
        encoding: "shift_jis",
        bytes: shiftJisReference,
      },
      sourceLanguage: "zh",
      referenceLanguage: "vi",
    });

    expect(result).toMatchObject({
      kind: "processed",
      draft: { referenceCues: [{ visibleText: "テスト" }] },
    });
  });
});

describe("worker-local parsed file reuse", () => {
  function cachedRequest(): ProcessSubtitleRequest {
    return {
      version: 1,
      operationId: "first",
      source: encodedInput(
        "source",
        "srt",
        "utf-8",
        "00:00:01,000 --> 00:00:02,000\nA",
      ),
      reference: encodedInput(
        "reference",
        "srt",
        "utf-8",
        "00:00:01,000 --> 00:00:02,000\nB",
      ),
      sourceLanguage: "ja",
      referenceLanguage: "en",
    };
  }

  it("reuses unaffected parsing on an encoding change but always creates a fresh alignment", () => {
    const parse = vi.spyOn(parser, "parseSubtitle");
    const process = createSubtitleProcessor();
    const input = cachedRequest();
    expect(process(input).kind).toBe("processed");
    const result = process({
      ...input,
      operationId: "second",
      sourceLanguage: "zh",
      source: { ...input.source, encoding: "shift_jis" },
    });
    expect(result).toMatchObject({
      kind: "processed",
      operationId: "second",
      draft: {
        id: "second",
        sourceLanguage: "zh",
        groups: [{ decision: "automatic" }],
      },
    });
    expect(parse.mock.calls.map(([file]) => file.artifactId)).toEqual([
      "source",
      "reference",
      "source",
    ]);
  });

  it("invalidates changed bytes even when the caller mutates and reuses the same ArrayBuffer", () => {
    const parse = vi.spyOn(parser, "parseSubtitle");
    const process = createSubtitleProcessor();
    const input = cachedRequest();
    process(input);
    const bytes = new Uint8Array(input.source.bytes);
    bytes[bytes.length - 1] = 0x43;
    const result = process({ ...input, operationId: "mutated" });
    expect(result).toMatchObject({
      kind: "processed",
      draft: { sourceCues: [{ visibleText: "C" }] },
    });
    expect(parse.mock.calls.map(([file]) => file.artifactId)).toEqual([
      "source",
      "reference",
      "source",
    ]);
  });

  it("invalidates identity and format changes rather than trusting equal bytes", () => {
    const parse = vi.spyOn(parser, "parseSubtitle");
    const process = createSubtitleProcessor();
    const input = cachedRequest();
    process(input);
    expect(
      process({
        ...input,
        source: { ...input.source, artifactId: "replacement" },
      }),
    ).toMatchObject({
      kind: "processed",
      draft: { sourceCues: [{ artifactId: "replacement" }] },
    });
    expect(
      process({
        ...input,
        source: { ...input.source, artifactId: "replacement", format: "ass" },
      }),
    ).toMatchObject({ kind: "processing-error", code: "missing-events" });
    expect(parse).toHaveBeenCalledTimes(4);
  });

  it("keeps the previous successful parse across a failed encoding replacement", () => {
    const parse = vi.spyOn(parser, "parseSubtitle");
    const process = createSubtitleProcessor();
    const input = cachedRequest();
    process(input);
    expect(
      process({
        ...input,
        source: {
          ...input.source,
          artifactId: "bad",
          bytes: new Uint8Array([0x83]).buffer,
        },
      }),
    ).toMatchObject({ kind: "processing-error", code: "invalid-encoding" });
    expect(process({ ...input, operationId: "retry-previous" })).toMatchObject({
      kind: "processed",
      operationId: "retry-previous",
    });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("retains only the last successful parse per role and starts each worker cache empty", () => {
    const parse = vi.spyOn(parser, "parseSubtitle");
    const process = createSubtitleProcessor();
    const input = cachedRequest();
    process(input);
    process({
      ...input,
      source: { ...input.source, artifactId: "source-2" },
      reference: { ...input.reference!, artifactId: "reference-2" },
    });
    process(input);
    expect(parse).toHaveBeenCalledTimes(6);
    createSubtitleProcessor()(input);
    expect(parse).toHaveBeenCalledTimes(8);
  });
});

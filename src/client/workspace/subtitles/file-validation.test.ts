import { describe, expect, it } from "vitest";
import {
  MAX_SUBTITLE_FILE_BYTES,
  validateSubtitleFileMetadata,
} from "./file-validation";
import { subtitleArtifactSchema } from "./contracts";

describe("validateSubtitleFileMetadata", () => {
  it.each([
    ["episode.SRT", "srt"],
    ["episode.ass", "ass"],
  ] as const)("accepts %s as %s", (name, format) => {
    expect(validateSubtitleFileMetadata({ name, size: 1 })).toEqual({
      kind: "valid",
      format,
    });
  });

  it("allows exactly 25 MiB and rejects one byte more before reading", () => {
    expect(
      validateSubtitleFileMetadata({
        name: "limit.srt",
        size: MAX_SUBTITLE_FILE_BYTES,
      }).kind,
    ).toBe("valid");
    expect(
      validateSubtitleFileMetadata({
        name: "too-large.ass",
        size: MAX_SUBTITLE_FILE_BYTES + 1,
      }),
    ).toMatchObject({ kind: "too-large", limit: MAX_SUBTITLE_FILE_BYTES });
  });

  it.each(["episode.txt", "episode.ssa", "subtitle", ".srt.exe"])(
    "rejects unsupported name %s",
    (name) =>
      expect(validateSubtitleFileMetadata({ name, size: 1 })).toMatchObject({
        kind: "unsupported-format",
      }),
  );

  it("rejects an artifact whose claimed size differs from its Blob size", () => {
    expect(
      subtitleArtifactSchema.safeParse({
        id: "artifact-1",
        role: "source",
        name: "episode.srt",
        size: 1,
        format: "srt",
        requestedEncoding: "utf-8",
        resolvedEncoding: "utf-8",
        bytes: new Blob(["12"]),
        status: "decoded",
      }).success,
    ).toBe(false);
  });

  it("rejects an artifact Blob larger than the 25 MiB limit", () => {
    const bytes = new Blob([new Uint8Array(MAX_SUBTITLE_FILE_BYTES + 1)]);
    expect(
      subtitleArtifactSchema.safeParse({
        id: "artifact-1",
        role: "source",
        name: "episode.srt",
        size: bytes.size,
        format: "srt",
        requestedEncoding: "utf-8",
        resolvedEncoding: "utf-8",
        bytes,
        status: "selected",
      }).success,
    ).toBe(false);
  });
});

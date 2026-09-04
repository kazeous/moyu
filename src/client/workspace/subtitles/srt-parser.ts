import type {
  SubtitleCue,
  SubtitleParseResult,
  SubtitleWarning,
} from "./contracts";

const lineEndingPattern = /\r\n|\n|\r/gu;
const knownTagPattern = /<\/?(?:i|b|u)\s*>|<\/?font(?:\s+[^<>]*)?>/giu;
const markupPattern = /<[^>]*>|[<>]/u;

function warning(
  code: SubtitleWarning["code"],
  message: string,
  sourceOrder: number,
): SubtitleWarning {
  return { code, message, sourceOrder };
}

function splitSrtBlocks(text: string): string[] {
  const separator = /(?:\r\n){2,}|(?:\n){2,}|(?:\r){2,}/gu;
  const blocks: string[] = [];
  let cursor = 0;

  for (const match of text.matchAll(separator)) {
    const delimiter = match[0];
    const delimiterStart = match.index ?? cursor;
    const lineEndings = delimiter.match(lineEndingPattern) ?? [];
    const preserveTrailingLine =
      lineEndings.length > 2 ? lineEndings.at(-1) : "";
    const block = text.slice(cursor, delimiterStart) + preserveTrailingLine;
    if (block !== "") blocks.push(block);
    cursor = delimiterStart + delimiter.length;
  }

  const finalBlock = text.slice(cursor);
  if (finalBlock !== "") blocks.push(finalBlock);
  return blocks;
}

function parseSrtTimestamp(value: string): number | null {
  const match = /^(\d+):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/u.exec(value.trim());
  if (!match) return null;

  const [, hours, minutes, seconds, fraction] = match;
  const milliseconds = Number(fraction.padEnd(3, "0"));
  return (
    (Number(hours) * 60 * 60 + Number(minutes) * 60 + Number(seconds)) * 1000 +
    milliseconds
  );
}

function deriveSrtVisibleText(rawPayload: string): {
  visibleText: string;
  warnings: SubtitleWarning[];
} {
  const visibleText = rawPayload.replace(knownTagPattern, "");
  return {
    visibleText,
    warnings: markupPattern.test(visibleText)
      ? [
          {
            code: "unknown-markup",
            message: "The cue contains markup that was preserved as text.",
            sourceOrder: null,
          },
        ]
      : [],
  };
}

function parseSrtCue(
  artifactId: string,
  rawPayload: string,
  sourceOrder: number,
): SubtitleCue {
  const lines = rawPayload.split(lineEndingPattern);
  const firstLineIsNumeric = /^\d+$/u.test(lines[0] ?? "");
  const firstLineContainsRange = (lines[0] ?? "").includes("-->");
  const secondLineContainsRange = (lines[1] ?? "").includes("-->");
  const timingLineIndex =
    firstLineIsNumeric && lines.length > 1
      ? 1
      : firstLineContainsRange
        ? 0
        : secondLineContainsRange
          ? 1
          : null;

  const payloadLines =
    timingLineIndex === null
      ? lines
      : timingLineIndex === 1 && !firstLineIsNumeric
        ? [lines[0] ?? "", ...lines.slice(2)]
        : lines.slice(timingLineIndex + 1);
  const derived = deriveSrtVisibleText(payloadLines.join("\n"));
  const warnings: SubtitleWarning[] = derived.warnings.map((item) => ({
    ...item,
    sourceOrder,
  }));

  let startMs: number | null = null;
  let endMs: number | null = null;
  const timingLine =
    timingLineIndex === null ? null : (lines[timingLineIndex] ?? "");
  const timeRange = timingLine?.split("-->");

  if (timingLineIndex === null) {
    warnings.unshift(
      warning(
        "missing-timestamp",
        "The cue has no timestamp range.",
        sourceOrder,
      ),
    );
  } else if (timeRange?.length !== 2) {
    warnings.unshift(
      warning(
        "invalid-timestamp",
        "The cue timestamp is invalid.",
        sourceOrder,
      ),
    );
  } else {
    const parsedStart = parseSrtTimestamp(timeRange[0] ?? "");
    const parsedEnd = parseSrtTimestamp(timeRange[1] ?? "");
    if (
      parsedStart === null ||
      parsedEnd === null ||
      parsedEnd <= parsedStart
    ) {
      warnings.unshift(
        warning(
          "invalid-timestamp",
          "The cue timestamp is invalid.",
          sourceOrder,
        ),
      );
    } else {
      startMs = parsedStart;
      endMs = parsedEnd;
    }
  }

  return {
    id: `${artifactId}:cue:${sourceOrder}`,
    artifactId,
    sourceOrder,
    startMs,
    endMs,
    rawPayload,
    visibleText: derived.visibleText,
    warnings,
  };
}

export function parseSrt(input: {
  artifactId: string;
  text: string;
}): SubtitleParseResult {
  const cues = splitSrtBlocks(input.text).map((rawPayload, sourceOrder) =>
    parseSrtCue(input.artifactId, rawPayload, sourceOrder),
  );

  return {
    kind: "parsed",
    cues,
    warnings: cues.flatMap((cue) => cue.warnings),
  };
}

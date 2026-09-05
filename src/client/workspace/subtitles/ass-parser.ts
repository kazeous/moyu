import type {
  SubtitleCue,
  SubtitleParseResult,
  SubtitleWarning,
} from "./contracts";

type EventFormat = Readonly<{
  columns: string[];
  startIndex: number;
  endIndex: number;
  textIndex: number;
  nameIndex: number | undefined;
  actorIndex: number | undefined;
}>;

function warning(
  code: SubtitleWarning["code"],
  message: string,
  sourceOrder: number,
): SubtitleWarning {
  return { code, message, sourceOrder };
}

function parseAssTimestamp(value: string): number | null {
  const match = /^(\d+):([0-5]\d):([0-5]\d)\.(\d{1,2})$/u.exec(value.trim());
  if (!match) return null;

  const [, hours, minutes, seconds, centiseconds] = match;
  return (
    (Number(hours) * 60 * 60 + Number(minutes) * 60 + Number(seconds)) * 1000 +
    Number(centiseconds.padEnd(2, "0")) * 10
  );
}

function splitDeclaredFields(
  value: string,
  fieldCount: number,
  textIndex: number,
): string[] | null {
  if (fieldCount < 1 || textIndex < 0 || textIndex >= fieldCount) return null;

  const fields = Array<string>(fieldCount);
  let remainder = value;

  for (let index = 0; index < textIndex; index += 1) {
    const commaIndex = remainder.indexOf(",");
    if (commaIndex < 0) return null;
    fields[index] = remainder.slice(0, commaIndex).trim();
    remainder = remainder.slice(commaIndex + 1);
  }

  for (let index = fieldCount - 1; index > textIndex; index -= 1) {
    const commaIndex = remainder.lastIndexOf(",");
    if (commaIndex < 0) return null;
    fields[index] = remainder.slice(commaIndex + 1).trim();
    remainder = remainder.slice(0, commaIndex);
  }

  fields[textIndex] = remainder;
  return fields;
}

function deriveAssVisibleText(rawText: string): {
  visibleText: string;
  warnings: SubtitleWarning[];
} {
  const withoutBalancedOverrides = rawText.replace(/\{[^{}]*\}/gu, "");
  const hasMalformedOverride = /[{}]/u.test(withoutBalancedOverrides);
  let hasMalformedDrawingScale = false;
  let drawingScale = 0;
  let cursor = 0;
  const visibleParts: string[] = [];

  if (!hasMalformedOverride) {
    for (const match of rawText.matchAll(/\{([^{}]*)\}/gu)) {
      if (drawingScale === 0) {
        visibleParts.push(rawText.slice(cursor, match.index));
      }

      const commands = match[1] ?? "";
      for (const drawingCommand of commands.matchAll(
        /\\p\s*([+-]?\d+)(?=\\|$|\s)/giu,
      )) {
        const scale = drawingCommand[1] ?? "";
        if (scale.startsWith("-")) {
          hasMalformedDrawingScale = true;
          continue;
        }
        drawingScale = Number(scale);
      }
      cursor = (match.index ?? 0) + match[0].length;
    }

    if (drawingScale === 0) {
      visibleParts.push(rawText.slice(cursor));
    }
  }

  const visibleText = (
    hasMalformedOverride ? withoutBalancedOverrides : visibleParts.join("")
  )
    .replace(/\\[Nn]/gu, "\n")
    .replace(/\\h/gu, " ");

  return {
    visibleText,
    warnings:
      hasMalformedOverride || hasMalformedDrawingScale
        ? [
            {
              code: "suspicious-override",
              message:
                "The cue contains a malformed drawing scale or override block.",
              sourceOrder: null,
            },
          ]
        : [],
  };
}

function getEventLines(text: string): string[] | null {
  const lines = text.split(/\r\n|\n|\r/u);
  const eventStart = lines.findIndex((line) =>
    /^\s*\[events\]\s*$/iu.test(line),
  );
  if (eventStart < 0) return null;

  const eventLines: string[] = [];
  for (const line of lines.slice(eventStart + 1)) {
    if (/^\s*\[[^\]]+\]\s*$/u.test(line)) break;
    eventLines.push(line);
  }
  return eventLines;
}

function getEventFormat(
  eventLines: string[],
):
  | Readonly<{ kind: "format"; format: EventFormat }>
  | Readonly<{ kind: "missing-format" }>
  | Readonly<{ kind: "missing-column" }> {
  let hasDeclaredFormat = false;
  let latestUsableColumns: string[] | undefined;
  for (const line of eventLines) {
    const match = /^\s*format\s*:(.*)$/iu.exec(line);
    if (!match) continue;
    const columns = (match[1] ?? "").split(",").map((column) => column.trim());
    if (!columns.every((column) => column !== "")) continue;
    hasDeclaredFormat = true;
    const normalized = columns.map((column) => column.toLowerCase());
    if (
      normalized.includes("start") &&
      normalized.includes("end") &&
      normalized.includes("text")
    ) {
      latestUsableColumns = columns;
    }
  }

  if (!latestUsableColumns) {
    return hasDeclaredFormat
      ? { kind: "missing-column" }
      : { kind: "missing-format" };
  }

  const normalized = latestUsableColumns.map((column) => column.toLowerCase());
  const startIndex = normalized.indexOf("start");
  const endIndex = normalized.indexOf("end");
  const textIndex = normalized.indexOf("text");
  return {
    kind: "format",
    format: {
      columns: latestUsableColumns,
      startIndex,
      endIndex,
      textIndex,
      nameIndex:
        normalized.indexOf("name") >= 0
          ? normalized.indexOf("name")
          : undefined,
      actorIndex:
        normalized.indexOf("actor") >= 0
          ? normalized.indexOf("actor")
          : undefined,
    },
  };
}

function parseDialogueCue(
  artifactId: string,
  rawPayload: string,
  payload: string,
  sourceOrder: number,
  format: EventFormat,
): SubtitleCue {
  const fields = splitDeclaredFields(
    payload,
    format.columns.length,
    format.textIndex,
  );
  if (!fields) {
    const malformedWarning = warning(
      "malformed-dialogue",
      "The Dialogue record does not match its declared Format columns.",
      sourceOrder,
    );
    return {
      id: `${artifactId}:cue:${sourceOrder}`,
      artifactId,
      sourceOrder,
      startMs: null,
      endMs: null,
      rawPayload,
      visibleText: payload,
      warnings: [malformedWarning],
    };
  }

  const derived = deriveAssVisibleText(fields[format.textIndex] ?? "");
  const warnings: SubtitleWarning[] = derived.warnings.map((item) => ({
    ...item,
    sourceOrder,
  }));
  const parsedStart = parseAssTimestamp(fields[format.startIndex] ?? "");
  const parsedEnd = parseAssTimestamp(fields[format.endIndex] ?? "");
  const hasValidRange =
    parsedStart !== null && parsedEnd !== null && parsedEnd > parsedStart;
  if (!hasValidRange) {
    warnings.unshift(
      warning(
        "invalid-timestamp",
        "The Dialogue timestamp is invalid.",
        sourceOrder,
      ),
    );
  }

  const name =
    format.nameIndex === undefined ? "" : fields[format.nameIndex]?.trim();
  const actor =
    format.actorIndex === undefined ? "" : fields[format.actorIndex]?.trim();
  const speaker = name || actor;

  return {
    id: `${artifactId}:cue:${sourceOrder}`,
    artifactId,
    sourceOrder,
    startMs: hasValidRange ? parsedStart : null,
    endMs: hasValidRange ? parsedEnd : null,
    rawPayload,
    visibleText: derived.visibleText,
    ...(speaker ? { speaker } : {}),
    warnings,
  };
}

export function parseAss(input: {
  artifactId: string;
  text: string;
}): SubtitleParseResult {
  const eventLines = getEventLines(input.text);
  if (!eventLines) {
    return {
      kind: "parse-error",
      code: "missing-events",
      message: "The ASS file has no Events section.",
    };
  }

  const eventFormat = getEventFormat(eventLines);
  if (eventFormat.kind === "missing-format") {
    return {
      kind: "parse-error",
      code: "missing-format",
      message: "The Events section has no usable Format declaration.",
    };
  }
  if (eventFormat.kind === "missing-column") {
    return {
      kind: "parse-error",
      code: "missing-column",
      message: "The Events Format must declare Start, End, and Text columns.",
    };
  }

  const cues: SubtitleCue[] = [];
  for (const line of eventLines) {
    const match = /^\s*dialogue\s*:(.*)$/iu.exec(line);
    if (!match) continue;
    const payload = (match[1] ?? "").trimStart();
    cues.push(
      parseDialogueCue(
        input.artifactId,
        line,
        payload,
        cues.length,
        eventFormat.format,
      ),
    );
  }

  return {
    kind: "parsed",
    cues,
    warnings: cues.flatMap((cue) => cue.warnings),
  };
}

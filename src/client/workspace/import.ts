import {
  type ReferenceLanguage,
  reviewSessionSchema,
  type ReviewSession,
  type SourceLanguage,
} from "./model";

export type ImportMode = "source-only" | "alternating";
export type ImportModeSuggestion = Readonly<{
  mode: ImportMode;
  confidence: "likely" | "uncertain";
  reason: string;
}>;

export type PreparedImport = {
  lines: ImportedReviewLine[];
  hasUnpairedLine: boolean;
};

export type ImportedReviewLine = { source: string; reference?: string };

const sourceScriptPattern =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const latinScriptPattern = /\p{Script=Latin}/u;

function splitImportedLines(value: string) {
  if (value === "") {
    return [];
  }

  return value.replace(/\r\n?/g, "\n").split("\n");
}

export function suggestImportMode(value: string): ImportModeSuggestion {
  const lines = splitImportedLines(value);
  const hasConsistentPairs =
    lines.length >= 2 &&
    lines.length % 2 === 0 &&
    lines.every((line, index) =>
      index % 2 === 0
        ? sourceScriptPattern.test(line)
        : latinScriptPattern.test(line) && !sourceScriptPattern.test(line),
    );

  if (hasConsistentPairs) {
    return {
      mode: "alternating",
      confidence: "likely",
      reason: "Source-script and Latin lines alternate consistently.",
    };
  }

  if (
    lines.length > 0 &&
    lines.every((line) => sourceScriptPattern.test(line))
  ) {
    return {
      mode: "source-only",
      confidence: "likely",
      reason: "Every pasted line uses Japanese or Chinese source script.",
    };
  }

  return {
    mode: "source-only",
    confidence: "uncertain",
    reason:
      lines.length === 0
        ? "Paste dialogue to receive a pairing suggestion."
        : "The line pattern is mixed, so pairing needs your confirmation.",
  };
}

export function prepareImport(value: string, mode: ImportMode): PreparedImport {
  const importedLines = splitImportedLines(value);

  if (mode === "source-only") {
    return {
      lines: importedLines.map((source) => ({ source })),
      hasUnpairedLine: false,
    };
  }

  return {
    lines: importedLines
      .filter((_, index) => index % 2 === 0)
      .map((source, index) => {
        const reference = importedLines[index * 2 + 1];

        return reference === undefined ? { source } : { source, reference };
      }),
    hasUnpairedLine: importedLines.length % 2 === 1,
  };
}

export function createReviewSession(
  value: string,
  mode: ImportMode,
  sourceLanguage: SourceLanguage,
  referenceLanguage: ReferenceLanguage,
): ReviewSession {
  const imported = prepareImport(value, mode);

  return createReviewSessionFromLines(
    imported.lines,
    sourceLanguage,
    referenceLanguage,
    value,
  );
}

export function createReviewSessionFromLines(
  importedLines: ImportedReviewLine[],
  sourceLanguage: SourceLanguage,
  referenceLanguage: ReferenceLanguage,
  rawImportText: string,
): ReviewSession {
  const lines = importedLines.map((line, index) => ({
    id: `line-${index + 1}`,
    ...line,
  }));

  return reviewSessionSchema.parse({
    version: 1,
    sourceLanguage,
    referenceLanguage,
    rawImportText,
    lines,
    activeLineId: lines[0]?.id ?? null,
    evidencePanelWidth: 360,
  });
}

import { z } from "zod";

export const MAX_SUBTITLE_FILE_BYTES = 25 * 1024 * 1024;

export const subtitleFormatSchema = z.enum(["srt", "ass"]);
export type SubtitleFormat = Readonly<z.infer<typeof subtitleFormatSchema>>;

export const requestedSubtitleEncodingSchema = z.enum([
  "utf-8",
  "shift_jis",
  "gb18030",
  "big5",
]);
export type RequestedSubtitleEncoding = Readonly<
  z.infer<typeof requestedSubtitleEncodingSchema>
>;

export const resolvedSubtitleEncodingSchema = z.enum([
  "utf-8",
  "utf-16le",
  "utf-16be",
  "shift_jis",
  "gb18030",
  "big5",
]);
export type ResolvedSubtitleEncoding = Readonly<
  z.infer<typeof resolvedSubtitleEncodingSchema>
>;

export const subtitleFileRoleSchema = z.enum(["source", "reference"]);
export type SubtitleFileRole = Readonly<z.infer<typeof subtitleFileRoleSchema>>;

export const subtitleWarningCodeSchema = z.enum([
  "missing-timestamp",
  "invalid-timestamp",
  "malformed-cue",
  "unknown-markup",
  "missing-events",
  "missing-format",
  "missing-column",
  "malformed-dialogue",
  "suspicious-override",
]);
export type SubtitleWarningCode = Readonly<
  z.infer<typeof subtitleWarningCodeSchema>
>;

export const subtitleWarningSchema = z
  .object({
    code: subtitleWarningCodeSchema,
    message: z.string().min(1),
    sourceOrder: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type SubtitleWarning = Readonly<z.infer<typeof subtitleWarningSchema>>;

export const subtitleCueSchema = z
  .object({
    id: z.string().min(1),
    artifactId: z.string().min(1),
    sourceOrder: z.number().int().nonnegative(),
    startMs: z.number().int().nonnegative().nullable(),
    endMs: z.number().int().nonnegative().nullable(),
    rawPayload: z.string(),
    visibleText: z.string(),
    speaker: z.string().optional(),
    warnings: z.array(subtitleWarningSchema),
  })
  .strict();
export type SubtitleCue = Readonly<z.infer<typeof subtitleCueSchema>>;

export const subtitleDecodeFailureSchema = z
  .object({
    kind: z.literal("invalid-encoding"),
    requested: requestedSubtitleEncodingSchema,
    reason: z.string().min(1),
  })
  .strict();
export type SubtitleDecodeFailure = Readonly<
  z.infer<typeof subtitleDecodeFailureSchema>
>;

export const subtitleDecodeResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("decoded"),
      text: z.string(),
      encoding: resolvedSubtitleEncodingSchema,
      hadBom: z.boolean(),
    })
    .strict(),
  subtitleDecodeFailureSchema,
]);
export type SubtitleDecodeResult = Readonly<
  z.infer<typeof subtitleDecodeResultSchema>
>;

export const subtitleParseFailureCodeSchema = z.enum([
  "missing-events",
  "missing-format",
  "missing-column",
  "malformed-dialogue",
]);
export type SubtitleParseFailureCode = Readonly<
  z.infer<typeof subtitleParseFailureCodeSchema>
>;

export const subtitleParseFailureSchema = z
  .object({
    kind: z.literal("parse-error"),
    code: subtitleParseFailureCodeSchema,
    message: z.string().min(1),
    warnings: z.array(subtitleWarningSchema).optional(),
  })
  .strict();
export type SubtitleParseFailure = Readonly<
  z.infer<typeof subtitleParseFailureSchema>
>;

export const subtitleParseResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("parsed"),
      cues: z.array(subtitleCueSchema),
      warnings: z.array(subtitleWarningSchema),
    })
    .strict(),
  subtitleParseFailureSchema,
]);
export type SubtitleParseResult = Readonly<
  z.infer<typeof subtitleParseResultSchema>
>;

export const subtitleProcessingFailureCodeSchema = z.enum([
  "invalid-encoding",
  "missing-events",
  "missing-format",
  "missing-column",
  "malformed-dialogue",
  "invalid-worker-message",
  "unexpected-error",
]);
export type SubtitleProcessingFailureCode = Readonly<
  z.infer<typeof subtitleProcessingFailureCodeSchema>
>;

export const subtitleProcessingFailureSchema = z
  .object({
    kind: z.literal("processing-error"),
    role: subtitleFileRoleSchema,
    code: subtitleProcessingFailureCodeSchema,
    retryable: z.boolean(),
    message: z.string().min(1),
  })
  .strict();
export type SubtitleProcessingFailure = Readonly<
  z.infer<typeof subtitleProcessingFailureSchema>
>;

export const subtitleArtifactStatusSchema = z.enum([
  "selected",
  "decoded",
  "failed",
]);
export type SubtitleArtifactStatus = Readonly<
  z.infer<typeof subtitleArtifactStatusSchema>
>;

export const subtitleArtifactSchema = z
  .object({
    id: z.string().min(1),
    role: subtitleFileRoleSchema,
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
    format: subtitleFormatSchema,
    requestedEncoding: requestedSubtitleEncodingSchema,
    resolvedEncoding: resolvedSubtitleEncodingSchema.nullable(),
    bytes: z.instanceof(Blob),
    status: subtitleArtifactStatusSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.size > MAX_SUBTITLE_FILE_BYTES) {
      context.addIssue({
        code: "too_big",
        maximum: MAX_SUBTITLE_FILE_BYTES,
        origin: "number",
        inclusive: true,
        path: ["size"],
        message: "Subtitle artifacts cannot exceed 25 MiB.",
      });
    }
    if (artifact.bytes.size !== artifact.size) {
      context.addIssue({
        code: "custom",
        path: ["bytes"],
        message: "Subtitle artifact size must match its Blob size.",
      });
    }
  });
export type SubtitleArtifact = Readonly<z.infer<typeof subtitleArtifactSchema>>;

export const alignmentDecisionSchema = z.enum([
  "automatic",
  "pending",
  "accepted",
  "source-only",
]);
export type AlignmentDecision = Readonly<
  z.infer<typeof alignmentDecisionSchema>
>;

export const alignmentGroupStatusSchema = z.enum([
  "confident",
  "needs-review",
  "source-only",
]);
export type AlignmentGroupStatus = Readonly<
  z.infer<typeof alignmentGroupStatusSchema>
>;

export const alignmentGroupSchema = z
  .object({
    id: z.string().min(1),
    sourceCueIds: z.array(z.string().min(1)).min(1),
    referenceCueIds: z.array(z.string().min(1)),
    status: alignmentGroupStatusSchema,
    confidence: z.number().int().min(0).max(100).nullable(),
    decision: alignmentDecisionSchema,
  })
  .strict();
export type AlignmentGroup = Readonly<{
  id: string;
  sourceCueIds: readonly [string, ...string[]];
  referenceCueIds: readonly string[];
  status: AlignmentGroupStatus;
  confidence: number | null;
  decision: AlignmentDecision;
}>;

export const subtitleImportDraftSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    sourceArtifactId: z.string().min(1),
    referenceArtifactId: z.string().min(1).optional(),
    sourceLanguage: z.enum(["ja", "zh"]),
    referenceLanguage: z.enum(["en", "vi"]),
    sourceCues: z.array(subtitleCueSchema),
    referenceCues: z.array(subtitleCueSchema),
    groups: z.array(alignmentGroupSchema),
    unassignedReferenceCueIds: z.array(z.string().min(1)),
    ignoredReferenceCueIds: z.array(z.string().min(1)),
    activeGroupId: z.string().min(1).nullable(),
    blockingFailures: z.array(subtitleProcessingFailureSchema),
  })
  .strict();
export type SubtitleImportDraft = Readonly<{
  version: 1;
  id: string;
  sourceArtifactId: string;
  referenceArtifactId?: string;
  sourceLanguage: "ja" | "zh";
  referenceLanguage: "en" | "vi";
  sourceCues: readonly SubtitleCue[];
  referenceCues: readonly SubtitleCue[];
  groups: readonly AlignmentGroup[];
  unassignedReferenceCueIds: readonly string[];
  ignoredReferenceCueIds: readonly string[];
  activeGroupId: string | null;
  blockingFailures: readonly SubtitleProcessingFailure[];
}>;

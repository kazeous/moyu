import { z } from "zod";

export const sourceLanguageSchema = z.enum(["ja", "zh"]);
export const referenceLanguageSchema = z.enum(["en", "vi"]);

export const reviewLineSchema = z
  .object({
    id: z.string().min(1),
    source: z.string(),
    reference: z.string().optional(),
  })
  .strict();

function validateSessionSelection(
  session: {
    lines: readonly { id: string }[];
    activeLineId: string | null;
  },
  context: z.RefinementCtx,
) {
  const lineIds = new Set<string>();

  session.lines.forEach((line, index) => {
    if (lineIds.has(line.id)) {
      context.addIssue({
        code: "custom",
        message: "Dialogue line identifiers must be unique.",
        path: ["lines", index, "id"],
      });
    }
    lineIds.add(line.id);
  });

  if (session.lines.length === 0 && session.activeLineId !== null) {
    context.addIssue({
      code: "custom",
      message: "An empty session cannot select a dialogue line.",
      path: ["activeLineId"],
    });
  }

  if (session.lines.length > 0 && session.activeLineId === null) {
    context.addIssue({
      code: "custom",
      message: "A non-empty session must select a dialogue line.",
      path: ["activeLineId"],
    });
  }

  if (session.activeLineId !== null && !lineIds.has(session.activeLineId)) {
    context.addIssue({
      code: "custom",
      message: "The active dialogue line must exist in the session.",
      path: ["activeLineId"],
    });
  }
}

export const reviewSessionV1Schema = z
  .object({
    version: z.literal(1),
    sourceLanguage: sourceLanguageSchema,
    referenceLanguage: referenceLanguageSchema,
    rawImportText: z.string(),
    lines: z.array(reviewLineSchema),
    activeLineId: z.string().min(1).nullable(),
    evidencePanelWidth: z.number().min(280).max(720),
  })
  .strict()
  .superRefine(validateSessionSelection);

const subtitleLineProvenanceSchema = z
  .object({
    sourceCueIds: z.array(z.string().min(1)).min(1),
    referenceCueIds: z.array(z.string().min(1)),
    startMs: z.number().int().nonnegative().nullable(),
    endMs: z.number().int().nonnegative().nullable(),
    speakers: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (new Set(provenance.speakers).size !== provenance.speakers.length) {
      context.addIssue({
        code: "custom",
        message: "Subtitle speakers must be ordered and de-duplicated.",
        path: ["speakers"],
      });
    }
  });

const reviewLineV2Schema = reviewLineSchema
  .extend({ subtitle: subtitleLineProvenanceSchema.optional() })
  .strict();

export const reviewSessionSchema = z
  .object({
    version: z.literal(2),
    sourceLanguage: sourceLanguageSchema,
    referenceLanguage: referenceLanguageSchema,
    origin: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("paste"), rawImportText: z.string() })
        .strict(),
      z
        .object({ kind: z.literal("subtitle"), importId: z.string().min(1) })
        .strict(),
    ]),
    lines: z.array(reviewLineV2Schema),
    activeLineId: z.string().min(1).nullable(),
    evidencePanelWidth: z.number().min(280).max(720),
  })
  .strict()
  .superRefine(validateSessionSelection);

export type SourceLanguage = z.infer<typeof sourceLanguageSchema>;
export type ReferenceLanguage = z.infer<typeof referenceLanguageSchema>;
export type ReviewLine = z.infer<typeof reviewLineV2Schema>;
export type ReviewSession = z.infer<typeof reviewSessionSchema>;

export type ReviewSessionMigrationResult =
  | Readonly<{ kind: "current"; session: ReviewSession }>
  | Readonly<{
      kind: "migrated";
      fromVersion: 1;
      session: ReviewSession;
    }>
  | Readonly<{ kind: "invalid"; reason: string }>;

export function migrateReviewSession(
  value: unknown,
): ReviewSessionMigrationResult {
  const current = reviewSessionSchema.safeParse(value);
  if (current.success) {
    return { kind: "current", session: current.data };
  }

  const legacy = reviewSessionV1Schema.safeParse(value);
  if (!legacy.success) {
    return {
      kind: "invalid",
      reason: "The saved local review session cannot be read safely.",
    };
  }

  const session = reviewSessionSchema.parse({
    version: 2,
    sourceLanguage: legacy.data.sourceLanguage,
    referenceLanguage: legacy.data.referenceLanguage,
    origin: {
      kind: "paste",
      rawImportText: legacy.data.rawImportText,
    },
    lines: legacy.data.lines,
    activeLineId: legacy.data.activeLineId,
    evidencePanelWidth: legacy.data.evidencePanelWidth,
  });

  return { kind: "migrated", fromVersion: 1, session };
}

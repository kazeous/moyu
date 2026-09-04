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

export const reviewSessionSchema = z
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
  .superRefine((session, context) => {
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
  });

export type SourceLanguage = z.infer<typeof sourceLanguageSchema>;
export type ReferenceLanguage = z.infer<typeof referenceLanguageSchema>;
export type ReviewLine = z.infer<typeof reviewLineSchema>;
export type ReviewSession = z.infer<typeof reviewSessionSchema>;

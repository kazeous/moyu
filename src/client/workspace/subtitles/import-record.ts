import { z } from "zod";

import { referenceLanguageSchema, sourceLanguageSchema } from "../model";
import {
  subtitleImportDraftSchema,
  subtitleProcessingFailureSchema,
  type SubtitleImportDraft,
  type SubtitleProcessingFailure,
} from "./contracts";

export type PersistedSubtitleImport = Readonly<{
  version: 1;
  id: string;
  source: Readonly<{
    artifactId: string;
    language: z.infer<typeof sourceLanguageSchema>;
  }>;
  reference: Readonly<{
    artifactId: string;
    language: z.infer<typeof referenceLanguageSchema>;
  }> | null;
  draft: SubtitleImportDraft | null;
  failure: SubtitleProcessingFailure | null;
}>;

export const persistedSubtitleImportSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    source: z
      .object({
        artifactId: z.string().min(1),
        language: sourceLanguageSchema,
      })
      .strict(),
    reference: z
      .object({
        artifactId: z.string().min(1),
        language: referenceLanguageSchema,
      })
      .strict()
      .nullable(),
    draft: subtitleImportDraftSchema.nullable(),
    failure: subtitleProcessingFailureSchema.nullable(),
  })
  .strict()
  .superRefine((record, context) => {
    const draft = record.draft;
    if (!draft) return;

    draft.sourceCues.forEach((cue, index) => {
      if (cue.artifactId !== draft.sourceArtifactId) {
        context.addIssue({
          code: "custom",
          path: ["draft", "sourceCues", index, "artifactId"],
          message: "Every source cue must reference the draft source artifact.",
        });
      }
    });

    if (draft.referenceArtifactId === undefined) {
      if (draft.referenceCues.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["draft", "referenceCues"],
          message:
            "A source-only draft cannot contain reference subtitle cues.",
        });
      }
      return;
    }

    draft.referenceCues.forEach((cue, index) => {
      if (cue.artifactId !== draft.referenceArtifactId) {
        context.addIssue({
          code: "custom",
          path: ["draft", "referenceCues", index, "artifactId"],
          message:
            "Every reference cue must reference the draft reference artifact.",
        });
      }
    });
  })
  .transform(
    (record): PersistedSubtitleImport =>
      record as unknown as PersistedSubtitleImport,
  );

export function referencedSubtitleArtifactIds(
  record: PersistedSubtitleImport,
): Set<string> {
  const artifactIds = new Set<string>([record.source.artifactId]);
  if (record.reference) artifactIds.add(record.reference.artifactId);
  if (record.draft) {
    artifactIds.add(record.draft.sourceArtifactId);
    if (record.draft.referenceArtifactId) {
      artifactIds.add(record.draft.referenceArtifactId);
    }
  }
  return artifactIds;
}

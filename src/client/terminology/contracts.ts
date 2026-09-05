import { z } from "zod";

const glossSchema = z
  .object({ language: z.enum(["en", "vi"]), text: z.string().min(1).max(500) })
  .strict();
export const confirmedPhraseSchema = z
  .object({
    sourcePhrase: z.string().min(1).max(300),
    language: z.enum(["ja", "zh"]),
    note: z.string().max(2000).optional(),
    glosses: z
      .array(glossSchema)
      .min(1)
      .max(2)
      .refine(
        (values) =>
          new Set(values.map((value) => value.language)).size === values.length,
      ),
    workTagIds: z.array(z.uuid()).min(1).max(20),
  })
  .strict();
export const accountSchema = z
  .object({ id: z.uuid(), displayName: z.string() })
  .strict();
export const tagInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    aliases: z.array(z.string().trim().min(1).max(80)).max(20),
  })
  .strict();
export const tagSchema = tagInputSchema.extend({ id: z.uuid() }).strict();
export const phraseSchema = z
  .object({
    id: z.uuid(),
    sourcePhrase: z.string().min(1).max(300),
    language: z.enum(["ja", "zh"]),
    note: z.string().max(2000).nullable(),
    matchingMode: z.literal("exact"),
    glosses: confirmedPhraseSchema.shape.glosses,
    workTags: z.array(tagSchema).min(1),
  })
  .strict();
export const pendingPhraseSchema = z
  .object({ id: z.uuid(), ownerId: z.uuid(), input: confirmedPhraseSchema })
  .strict();
export type ConfirmedPhrase = z.infer<typeof confirmedPhraseSchema>;
export type Account = z.infer<typeof accountSchema>;
export type PersonalTag = z.infer<typeof tagSchema>;
export type PersonalPhrase = z.infer<typeof phraseSchema>;
export type PendingPhrase = z.infer<typeof pendingPhraseSchema>;

import { z } from "zod";

const glossSchema = z
  .object({
    language: z.enum(["en", "vi"]),
    text: z.string().min(1).max(500),
  })
  .strict();

export const createPhraseInputSchema = z
  .object({
    sourcePhrase: z.string().min(1).max(300),
    language: z.enum(["ja", "zh"]),
    note: z.string().max(2_000).optional(),
    glosses: z.array(glossSchema).min(1).max(2),
    workTagIds: z.array(z.string().uuid()).min(1).max(20),
  })
  .strict()
  .superRefine(({ glosses }, context) => {
    const languages = new Set<string>();

    for (const [index, gloss] of glosses.entries()) {
      if (languages.has(gloss.language)) {
        context.addIssue({
          code: "custom",
          message: "Each gloss language may be supplied only once",
          path: ["glosses", index, "language"],
        });
      }
      languages.add(gloss.language);
    }
  });

export type CreatePhraseInput = z.infer<typeof createPhraseInputSchema>;

export const workTagInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    aliases: z.array(z.string().trim().min(1).max(80)).max(20),
  })
  .strict();

export type WorkTagInput = z.infer<typeof workTagInputSchema>;

export const updateUserSettingsInputSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]).optional(),
    interfaceLanguage: z.enum(["en", "vi"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting must be supplied",
  });

export type UpdateUserSettingsInput = z.infer<
  typeof updateUserSettingsInputSchema
>;

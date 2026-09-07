import { z } from "zod";

export const languageSchema = z.enum(["ja", "zh"]);
const text = z.string().min(1);
const localAsset = z.string().regex(/^\/lexical\/[a-zA-Z0-9._-]+$/);
const httpsUrl = z.url().refine((url) => url.startsWith("https://"));
export const dictionaryEntrySchema = z
  .object({
    id: text,
    headwords: z.array(text).min(1),
    readings: z.array(text),
    partsOfSpeech: z.array(text),
    senses: z.array(
      z.object({ language: z.enum(["en", "vi"]), text }).strict(),
    ),
  })
  .strict();
export const dictionaryPackSchema = z
  .object({
    version: z.literal(1),
    sourceId: text,
    entries: z.array(dictionaryEntrySchema),
  })
  .strict();
export const sourceSchema = z
  .object({
    id: text,
    name: text,
    language: languageSchema,
    glossLanguages: z.array(z.enum(["en", "vi"])).min(1),
    version: text,
    sourceUrl: httpsUrl,
    license: text,
    licenseUrl: httpsUrl,
    attribution: text,
    noticeUrl: localAsset,
    updatePolicy: text,
    changes: text,
    url: localAsset,
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    entryCount: z.number().int().positive(),
  })
  .strict();
export const manifestSchema = z
  .object({ version: z.literal(1), sources: z.array(sourceSchema).min(1) })
  .strict()
  .refine(
    ({ sources }) =>
      new Set(sources.map((source) => source.id)).size === sources.length,
    "Duplicate source identifiers",
  );

export type Language = z.infer<typeof languageSchema>;
export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>;
export type DictionaryPack = z.infer<typeof dictionaryPackSchema>;
export type DictionarySource = z.infer<typeof sourceSchema>;
export type DictionaryManifest = z.infer<typeof manifestSchema>;

export const evidenceEntrySchema = dictionaryEntrySchema
  .extend({ sourceId: text })
  .strict();
const spanSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    surface: z.string(),
  })
  .strict();
export const tokenSchema = spanSchema
  .extend({
    lookupKey: z.string(),
    status: z.enum(["known", "unknown", "ambiguous", "literal"]),
    entries: z.array(evidenceEntrySchema),
  })
  .strict();
export const analysisSchema = z
  .object({
    language: languageSchema,
    method: z.literal("dictionary-longest-match"),
    tokens: z.array(tokenSchema),
    alternatives: z.array(tokenSchema),
  })
  .strict();
export type Token = z.infer<typeof tokenSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export const phraseMatchInputSchema = z
  .object({
    id: text,
    language: languageSchema,
    sourcePhrase: text,
    workTagIds: z.array(text),
  })
  .strict();
export const phraseOverlaySchema = spanSchema
  .extend({ phraseId: text })
  .strict();
export type PhraseMatchInput = z.infer<typeof phraseMatchInputSchema>;
export type PhraseOverlay = z.infer<typeof phraseOverlaySchema>;

export const workerRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("load"),
      id: text,
      download: z.boolean(),
      language: languageSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("analyze"),
      id: text,
      source: z.string(),
      language: languageSchema,
      phrases: z.array(phraseMatchInputSchema),
      workTagIds: z.array(text),
    })
    .strict(),
]);
export const workerResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("loaded"),
      id: text,
      sources: z.array(sourceSchema),
      installedIds: z.array(text),
      unavailableIds: z.array(text),
      updateIds: z.array(text),
      downloadBytes: z.number().int().nonnegative(),
      cacheAvailable: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("analyzed"),
      id: text,
      analysis: analysisSchema,
      overlays: z.array(phraseOverlaySchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unavailable"),
      id: text,
      reason: z.enum(["assets", "worker", "invalid", "timeout"]),
      retryable: z.literal(true),
    })
    .strict(),
]);
export type WorkerRequest = z.infer<typeof workerRequestSchema>;
export type WorkerResponse = z.infer<typeof workerResponseSchema>;

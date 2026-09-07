import { z } from "zod";
import { prepareImport, type ImportMode } from "../import";
import { reviewSessionSchema, type ReferenceLanguage } from "../model";

export const ocrLanguageSchema = z.enum(["jpn", "chi_sim", "chi_tra"]);
export type OcrLanguage = z.infer<typeof ocrLanguageSchema>;
export const imageSchema = z
  .instanceof(Blob)
  .refine(
    (image) =>
      ["image/png", "image/jpeg", "image/webp", "image/bmp"].includes(
        image.type,
      ) &&
      image.size > 0 &&
      image.size <= 25 * 1024 * 1024,
    "Choose a PNG, JPEG, WebP or BMP image up to 25 MiB.",
  );
export const ocrImportSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    image: imageSchema,
    language: ocrLanguageSchema,
    mode: z.enum(["source-only", "alternating"]).default("source-only"),
    referenceLanguage: z.enum(["en", "vi"]).default("en"),
    rawText: z.string(),
    editedText: z.string(),
    confidence: z.number().min(0).max(100).nullable(),
    status: z.enum(["ready", "recognized", "unavailable", "cancelled"]),
  })
  .strict();
export type OcrImport = z.infer<typeof ocrImportSchema>;

const storedOcrImportSchema = ocrImportSchema
  .omit({ image: true })
  .extend({
    image: z
      .object({
        type: z.string(),
        bytes: z
          .instanceof(ArrayBuffer)
          .refine(
            (bytes) =>
              bytes.byteLength > 0 && bytes.byteLength <= 25 * 1024 * 1024,
          ),
      })
      .strict(),
  })
  .strict();

export async function serializeOcrImport(draft: OcrImport) {
  ocrImportSchema.parse(draft);
  return storedOcrImportSchema.parse({
    ...draft,
    image: { type: draft.image.type, bytes: await draft.image.arrayBuffer() },
  });
}

export function restoreOcrImport(value: unknown): OcrImport {
  const existing = ocrImportSchema.safeParse(value);
  if (existing.success) return existing.data;
  const record = storedOcrImportSchema.parse(value);
  return ocrImportSchema.parse({
    ...record,
    image: new Blob([record.image.bytes], { type: record.image.type }),
  });
}

export function createOcrImport(
  image: Blob,
  language: OcrLanguage,
  id: string,
): OcrImport {
  return ocrImportSchema.parse({
    version: 1,
    id,
    createdAt: Date.now(),
    image,
    language,
    rawText: "",
    editedText: "",
    confidence: null,
    status: "ready",
  });
}

export function reviewFromOcr(
  draft: OcrImport,
  mode: ImportMode,
  referenceLanguage: ReferenceLanguage,
  createId: () => string = () => crypto.randomUUID(),
) {
  ocrImportSchema.parse(draft);
  if (!draft.editedText.trim())
    throw new Error("Correct or enter the image text before importing.");
  const lines = prepareImport(draft.editedText, mode).lines.map((line) => ({
    id: createId(),
    ...line,
  }));
  return reviewSessionSchema.parse({
    version: 2,
    sourceLanguage: draft.language === "jpn" ? "ja" : "zh",
    referenceLanguage,
    origin: { kind: "ocr", importId: draft.id },
    lines,
    activeLineId: lines[0]?.id ?? null,
    evidencePanelWidth: 360,
  });
}

export const ocrRequestSchema = z
  .object({ image: imageSchema, language: ocrLanguageSchema })
  .strict();
export const ocrResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("progress"), progress: z.number().min(0).max(1) })
    .strict(),
  z
    .object({
      kind: z.literal("recognized"),
      text: z.string(),
      confidence: z.number().min(0).max(100),
    })
    .strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
]);
export type OcrResponse = z.infer<typeof ocrResponseSchema>;

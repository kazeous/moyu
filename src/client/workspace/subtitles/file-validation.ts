import { z } from "zod";
import type { SubtitleFormat } from "./contracts";

export const MAX_SUBTITLE_FILE_BYTES = 25 * 1024 * 1024;

const metadataSchema = z
  .object({
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
  })
  .strict();

export type SubtitleFileValidationResult =
  | Readonly<{ kind: "valid"; format: SubtitleFormat }>
  | Readonly<{ kind: "invalid-metadata"; reason: string }>
  | Readonly<{ kind: "unsupported-format"; name: string }>
  | Readonly<{ kind: "too-large"; size: number; limit: number }>;

export function validateSubtitleFileMetadata(
  input: unknown,
): SubtitleFileValidationResult {
  const parsed = metadataSchema.safeParse(input);
  if (!parsed.success) {
    return {
      kind: "invalid-metadata",
      reason: "Invalid subtitle file metadata.",
    };
  }
  if (parsed.data.size > MAX_SUBTITLE_FILE_BYTES) {
    return {
      kind: "too-large",
      size: parsed.data.size,
      limit: MAX_SUBTITLE_FILE_BYTES,
    };
  }
  const extension = /\.([^.]+)$/u.exec(parsed.data.name)?.[1]?.toLowerCase();
  return extension === "srt" || extension === "ass"
    ? { kind: "valid", format: extension }
    : { kind: "unsupported-format", name: parsed.data.name };
}

import { z } from "zod";
import { parseEnv } from "@/server/env";
import type { CustomPhrase } from "@/server/db/repositories/phrases";
import type { WorkTag } from "@/server/db/repositories/work-tags";
import { readJson, requireEmptyBody } from "./body";
import { hasValidOrigin } from "./origin";
import { handleRequest, HttpError, jsonResponse } from "./response";
import { requireUser } from "./session";

export type DetailContext = { params: Promise<{ id: string }> };
export async function detailId(context: DetailContext): Promise<string> {
  const parsed = z.uuid().safeParse((await context.params).id);
  if (!parsed.success) throw new HttpError(404, "Not found.");
  return parsed.data;
}
export function presentTag(tag: WorkTag) {
  return { id: tag.id, name: tag.name, aliases: tag.aliases };
}
export function presentPhrase(phrase: CustomPhrase) {
  return {
    id: phrase.id,
    sourcePhrase: phrase.sourcePhrase,
    language: phrase.language,
    note: phrase.note,
    matchingMode: phrase.matchingMode,
    glosses: phrase.glosses.map(({ language, text }) => ({ language, text })),
    workTags: phrase.workTags.map(presentTag),
  };
}
export function presentFound<T, R>(
  value: T | null,
  present: (value: T) => R,
): R {
  if (value === null) throw new HttpError(404, "Not found.");
  return present(value);
}
export function metadataRead(
  operation: (ownerId: string) => Promise<unknown>,
  request: Request,
) {
  return handleRequest(async () => {
    const user = await requireUser(request);
    return jsonResponse(await operation(user.id));
  });
}
export function metadataMutation<T>(
  request: Request,
  schema: z.ZodType<T>,
  operation: (ownerId: string, input: T) => Promise<unknown>,
  status = 200,
) {
  return handleRequest(async () => {
    const user = await requireUser(request);
    if (!hasValidOrigin(request, parseEnv(process.env).appOrigin))
      throw new HttpError(403, "Invalid origin.");
    const input = await readJson(request, schema);
    try {
      return jsonResponse(await operation(user.id, input), status);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Work tags must belong to the phrase owner"
      )
        throw new HttpError(400, "Invalid request.");
      throw error;
    }
  });
}
export function metadataDelete(
  request: Request,
  operation: (ownerId: string) => Promise<boolean>,
) {
  return handleRequest(async () => {
    const user = await requireUser(request);
    if (!hasValidOrigin(request, parseEnv(process.env).appOrigin))
      throw new HttpError(403, "Invalid origin.");
    // DELETE is bodyless: do not accept a hidden metadata/review payload.
    await requireEmptyBody(request);
    if (!(await operation(user.id))) throw new HttpError(404, "Not found.");
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  });
}

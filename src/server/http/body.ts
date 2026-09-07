import { z } from "zod";
import { HttpError } from "./response";

const maximumBytes = 16_384;
export async function requireEmptyBody(request: Request): Promise<void> {
  const reader = request.body?.getReader();
  if (!reader) return;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value.byteLength > 0) {
        await reader.cancel();
        throw new HttpError(400, "Invalid request.");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const invalid = () => new HttpError(400, "Invalid request.");
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw invalid();
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw invalid();
      }
      chunks.push(value);
    }
    const parsed = schema.safeParse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      ),
    );
    if (!parsed.success) throw invalid();
    return parsed.data;
  } catch {
    throw invalid();
  } finally {
    reader.releaseLock();
  }
}

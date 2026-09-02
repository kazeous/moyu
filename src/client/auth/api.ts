import { z } from "zod";

const responseSchema = z.union([
  z.object({ ok: z.literal(true) }).strict(),
  z
    .object({
      user: z
        .object({ id: z.uuid(), email: z.email(), displayName: z.string() })
        .strict(),
    })
    .strict(),
  z.object({ error: z.string() }).strict(),
]);

export async function submitAuth(
  path: string,
  input: Record<string, string>,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("Connection unavailable. Please try again.");
  }
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new Error("Service unavailable. Please try again.");
  if ("error" in parsed.data) throw new Error(parsed.data.error);
  if (!response.ok) throw new Error("Unable to sign in. Please try again.");
}

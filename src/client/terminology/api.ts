import { z } from "zod";

export type LibraryFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;
export class LibraryRequestError extends Error {
  constructor(public readonly status: number) {
    super("Personal library request failed.");
  }
}
export async function libraryRequest<T>(
  fetcher: LibraryFetcher,
  url: string,
  schema: z.ZodType<T>,
  ownerId?: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (ownerId) headers.set("X-Moyu-Owner", z.uuid().parse(ownerId));
  const response = await fetcher(url, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new LibraryRequestError(response.status);
  return schema.parse(await response.json());
}

import { getSessionUser } from "@/server/auth/sessions";
import { z } from "zod";
import {
  handleRequest,
  HttpError,
  jsonResponse,
  SESSION_COOKIE_NAME,
} from "./response";

export function optionalUuidHeader(request: Request, name: string) {
  const value = request.headers.get(name);
  if (value === null) return undefined;
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(400, "Invalid request header.");
  return parsed.data;
}

export function requestSessionToken(request: Request): string {
  const pair = request.headers
    .get("cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE_NAME}=`));
  return pair?.slice(SESSION_COOKIE_NAME.length + 1) ?? "";
}
export async function requireUser(request: Request) {
  const user = await getSessionUser(requestSessionToken(request));
  if (!user) throw new HttpError(401, "Sign in required.");
  const expectedOwner = optionalUuidHeader(request, "X-Moyu-Owner");
  if (expectedOwner && expectedOwner !== user.id)
    throw new HttpError(
      409,
      "Account changed. Load your personal library again.",
    );
  return user;
}

export function accountIdentity(request: Request) {
  return handleRequest(async () => {
    const user = await requireUser(request);
    return jsonResponse({ id: user.id, displayName: user.displayName });
  });
}

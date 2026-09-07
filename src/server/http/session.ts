import { getSessionUser } from "@/server/auth/sessions";
import { HttpError, SESSION_COOKIE_NAME } from "./response";

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
  return user;
}

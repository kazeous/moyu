import { z } from "zod";
import { parseEnv } from "@/server/env";
import { authenticatePassword, registerAccount } from "@/server/auth/accounts";
import {
  signInInputSchema,
  signUpInputSchema,
  magicLinkInputSchema,
  verifyMagicLinkInputSchema,
  emptyInputSchema,
} from "@/server/auth/contracts";
import { createSession, revokeSession } from "@/server/auth/sessions";
import { consumeMagicLink, issueMagicLink } from "@/server/auth/magic-links";
import { findUserByEmail, type User } from "@/server/db/repositories/users";
import { createSmtpMailer } from "@/server/email/mailer";
import { readJson } from "./body";
import { hasValidOrigin, clientIp } from "./origin";
import { authLimiter } from "./rate-limit";
import {
  handleRequest,
  HttpError,
  jsonResponse,
  sessionCookie,
} from "./response";
import { requestSessionToken } from "./session";

function authAction<T>(
  schema: z.ZodType<T>,
  action: (input: T, request: Request) => Promise<Response>,
  rateLimited = true,
) {
  return (request: Request) =>
    handleRequest(async () => {
      const env = parseEnv(process.env);
      if (!hasValidOrigin(request, env.appOrigin))
        throw new HttpError(403, "Invalid origin.");
      if (
        rateLimited &&
        !authLimiter.allow(clientIp(request, env.trustProxy ?? false))
      )
        throw new HttpError(429, "Too many attempts. Try again later.");
      const input = await readJson(request, schema);
      if (
        typeof input === "object" &&
        input !== null &&
        "email" in input &&
        typeof input.email === "string" &&
        !authLimiter.allowEmail(input.email)
      )
        throw new HttpError(429, "Too many attempts. Try again later.");
      return action(input, request);
    });
}

async function signInResponse(user: User, status = 200) {
  const session = await createSession(user.id);
  const response = jsonResponse(
    { user: { id: user.id, email: user.email, displayName: user.displayName } },
    status,
  );
  response.headers.set(
    "Set-Cookie",
    sessionCookie(session.rawToken, session.expiresAt),
  );
  return response;
}

export const signUp = authAction(signUpInputSchema, async (input) =>
  signInResponse(await registerAccount(input), 201),
);
export const signIn = authAction(signInInputSchema, async (input) =>
  signInResponse(await authenticatePassword(input)),
);
export const requestMagicLink = authAction(
  magicLinkInputSchema,
  async ({ email }) => {
    const user = await findUserByEmail(email);
    if (user) {
      const env = parseEnv(process.env);
      const issued = await issueMagicLink(user.email);
      const url = new URL("/auth/confirm", env.appOrigin);
      url.hash = issued.rawToken;
      await createSmtpMailer(env).sendMagicLink({
        to: user.email,
        url: url.toString(),
      });
    }
    return jsonResponse({ ok: true });
  },
);
export const verifyMagicLink = authAction(
  verifyMagicLinkInputSchema,
  async ({ token }) => {
    let user: User;
    try {
      user = await consumeMagicLink(token);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Magic link is invalid or expired"
      )
        throw new HttpError(401, "Magic link is invalid or expired.");
      throw error;
    }
    // Await token transaction commit before creating any authenticated session.
    return signInResponse(user);
  },
);
export const signOut = authAction(
  emptyInputSchema,
  async (_input, request) => {
    await revokeSession(requestSessionToken(request));
    const response = jsonResponse({ ok: true });
    response.headers.set("Set-Cookie", sessionCookie("", new Date(0)));
    return response;
  },
  false,
);

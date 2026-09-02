import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDatabaseClient } from "@/server/db/client";
import type { User } from "@/server/db/repositories/users";
import { magicLinkTokens, users } from "@/server/db/schema";

import { generateToken, hashToken, isValidToken } from "./tokens";

export const MAGIC_LINK_LIFETIME_MS = 15 * 60 * 1000;
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Internal mail-delivery material. Never serialize this result into an HTTP response. */
export async function issueMagicLink(
  email: string,
): Promise<{ rawToken: string; tokenHash: string; expiresAt: Date }> {
  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) throw new Error("Invalid email address");
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_LIFETIME_MS);
  await getDatabaseClient()
    .insert(magicLinkTokens)
    .values({ email: parsedEmail.data, tokenHash, expiresAt });
  return { rawToken, tokenHash, expiresAt };
}

export async function consumeMagicLink(rawToken: string): Promise<User> {
  if (!isValidToken(rawToken))
    throw new Error("Magic link is invalid or expired");

  return getDatabaseClient().transaction(async (transaction) => {
    // A conditional UPDATE locks the token row and rechecks use/expiry on contention.
    // The caller may create a session only after this transaction has committed.
    const [consumed] = await transaction
      .update(magicLinkTokens)
      .set({ usedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(magicLinkTokens.tokenHash, hashToken(rawToken)),
          isNull(magicLinkTokens.usedAt),
          gt(magicLinkTokens.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .returning({ email: magicLinkTokens.email });
    if (!consumed) throw new Error("Magic link is invalid or expired");

    const [user] = await transaction
      .select()
      .from(users)
      .where(eq(users.email, consumed.email));
    if (!user) throw new Error("Magic link is invalid or expired");
    return user;
  });
}

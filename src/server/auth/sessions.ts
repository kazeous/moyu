import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { getDatabaseClient } from "@/server/db/client";
import type { User } from "@/server/db/repositories/users";
import { authSessions, users } from "@/server/db/schema";

import { generateToken, hashToken, isValidToken } from "./tokens";

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(
  userId: string,
): Promise<{ rawToken: string; expiresAt: Date }> {
  const ownerId = z.uuid().parse(userId);
  const rawToken = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await getDatabaseClient()
    .insert(authSessions)
    .values({ userId: ownerId, tokenHash: hashToken(rawToken), expiresAt });
  return { rawToken, expiresAt };
}

export async function getSessionUser(rawToken: string): Promise<User | null> {
  if (!isValidToken(rawToken)) return null;
  const [session] = await getDatabaseClient()
    .select({ user: users })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.tokenHash, hashToken(rawToken)),
        gt(authSessions.expiresAt, sql`clock_timestamp()`),
      ),
    );
  return session?.user ?? null;
}

export async function revokeSession(rawToken: string): Promise<void> {
  if (!isValidToken(rawToken)) return;
  await getDatabaseClient()
    .delete(authSessions)
    .where(eq(authSessions.tokenHash, hashToken(rawToken)));
}

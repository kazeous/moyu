import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { useAuthDatabaseFixtures } from "@/test/auth-database";
import { getDatabaseClient } from "@/server/db/client";
import { authSessions, users } from "@/server/db/schema";

import { createSession, getSessionUser, revokeSession } from "./sessions";

const fixture = useAuthDatabaseFixtures();

describe("sessions", () => {
  it("persists only a token hash and resolves the authenticated account", async () => {
    const user = await fixture.user();
    const before = Date.now();
    const issued = await createSession(user.id);
    const [stored] = await getDatabaseClient()
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, user.id));

    expect(Buffer.from(issued.rawToken, "base64url")).toHaveLength(32);
    expect(stored.tokenHash).toBe(
      createHash("sha256").update(issued.rawToken).digest("hex"),
    );
    expect(JSON.stringify(stored)).not.toContain(issued.rawToken);
    expect(stored.expiresAt).toEqual(issued.expiresAt);
    expect(issued.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 30 * 24 * 60 * 60 * 1000,
    );
    expect(issued.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    );
    await expect(getSessionUser(issued.rawToken)).resolves.toEqual(user);
  });

  it("does not authenticate expired, unknown, or malformed tokens", async () => {
    const user = await fixture.user();
    const { rawToken } = await createSession(user.id);
    await getDatabaseClient()
      .update(authSessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(authSessions.userId, user.id));

    await expect(getSessionUser(rawToken)).resolves.toBeNull();
    await expect(getSessionUser("A".repeat(43))).resolves.toBeNull();
    await expect(getSessionUser("invalid")).resolves.toBeNull();
  });

  it("revokes only the requested session and tolerates repeated revocation", async () => {
    const user = await fixture.user();
    const first = await createSession(user.id);
    const second = await createSession(user.id);
    expect(first.rawToken).not.toBe(second.rawToken);
    await revokeSession(first.rawToken);
    await revokeSession(first.rawToken);
    await revokeSession("invalid");

    await expect(getSessionUser(first.rawToken)).resolves.toBeNull();
    await expect(getSessionUser(second.rawToken)).resolves.toEqual(user);
    const stored = await getDatabaseClient()
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, user.id));
    expect(stored).toHaveLength(1);
  });

  it("cannot authenticate a deleted account", async () => {
    const user = await fixture.user();
    const { rawToken } = await createSession(user.id);
    await getDatabaseClient().delete(users).where(eq(users.id, user.id));
    await expect(getSessionUser(rawToken)).resolves.toBeNull();
  });
});

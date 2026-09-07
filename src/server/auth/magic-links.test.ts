import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { useAuthDatabaseFixtures } from "@/test/auth-database";
import { getDatabaseClient } from "@/server/db/client";
import { magicLinkTokens } from "@/server/db/schema";

import { consumeMagicLink, issueMagicLink } from "./magic-links";

const fixture = useAuthDatabaseFixtures();

describe("magic links", () => {
  it("stores no reusable magic-link secret and gives the link a short expiry", async () => {
    const user = await fixture.user();
    const before = Date.now();
    const issued = await issueMagicLink(`  ${user.email.toUpperCase()}  `);
    const [stored] = await getDatabaseClient()
      .select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.email, user.email));

    expect(Buffer.from(issued.rawToken, "base64url")).toHaveLength(32);
    expect(issued.tokenHash).not.toContain(issued.rawToken);
    expect(stored.tokenHash).toBe(
      createHash("sha256").update(issued.rawToken).digest("hex"),
    );
    expect(stored.tokenHash).toBe(issued.tokenHash);
    expect(JSON.stringify(stored)).not.toContain(issued.rawToken);
    expect(stored.usedAt).toBeNull();
    expect(stored.expiresAt).toEqual(issued.expiresAt);
    expect(issued.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 15 * 60 * 1000,
    );
    expect(issued.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 15 * 60 * 1000,
    );
  });

  it("invalidates a magic link after one use", async () => {
    const user = await fixture.user();
    const { rawToken, tokenHash } = await issueMagicLink(user.email);
    await expect(consumeMagicLink(rawToken)).resolves.toEqual(user);
    await expect(consumeMagicLink(rawToken)).rejects.toThrow(
      "Magic link is invalid or expired",
    );
    const [stored] = await getDatabaseClient()
      .select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash));
    expect(stored.usedAt).toBeInstanceOf(Date);
  });

  it("permits exactly one successful concurrent consumption", async () => {
    const user = await fixture.user();
    const { rawToken } = await issueMagicLink(user.email);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => consumeMagicLink(rawToken)),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toEqual([
      { status: "fulfilled", value: user },
    ]);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(5);
    for (const result of rejected)
      expect(result.reason).toEqual(
        new Error("Magic link is invalid or expired"),
      );
  });

  it("rejects expired tokens without marking them used", async () => {
    const user = await fixture.user();
    const { rawToken, tokenHash } = await issueMagicLink(user.email);
    await getDatabaseClient()
      .update(magicLinkTokens)
      .set({ expiresAt: new Date(0) })
      .where(eq(magicLinkTokens.tokenHash, tokenHash));
    await expect(consumeMagicLink(rawToken)).rejects.toThrow(
      "Magic link is invalid or expired",
    );
    const [stored] = await getDatabaseClient()
      .select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash));
    expect(stored.usedAt).toBeNull();
  });

  it("does not create accounts and rolls consumption back when no account exists", async () => {
    const { rawToken, tokenHash } = await issueMagicLink(fixture.email());
    await expect(consumeMagicLink(rawToken)).rejects.toThrow(
      "Magic link is invalid or expired",
    );
    const [stored] = await getDatabaseClient()
      .select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash));
    expect(stored.usedAt).toBeNull();
  });

  it.each(["invalid", "A".repeat(43)])(
    "rejects unknown or malformed secrets",
    async (rawToken) => {
      await expect(consumeMagicLink(rawToken)).rejects.toThrow(
        "Magic link is invalid or expired",
      );
    },
  );

  it("rejects an invalid email before issuing a token", async () => {
    await expect(issueMagicLink("not-an-email")).rejects.toThrow(
      "Invalid email address",
    );
  });
});

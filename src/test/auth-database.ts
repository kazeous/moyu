import { randomUUID } from "node:crypto";

import { inArray } from "drizzle-orm";
import { afterEach, beforeAll } from "vitest";

import { getDatabaseClient } from "@/server/db/client";
import { createUser } from "@/server/db/repositories/users";
import { magicLinkTokens, users } from "@/server/db/schema";

export function useAuthDatabaseFixtures() {
  const emails: string[] = [];

  beforeAll(() => {
    process.env.DATABASE_URL ??= "postgresql://moyu:moyu@localhost:5432/moyu";
    process.env.APP_ORIGIN ??= "http://localhost:3000";
    process.env.AUTH_COOKIE_SECRET ??=
      "test-secret-at-least-thirty-two-characters";
    process.env.SMTP_HOST ??= "localhost";
    process.env.SMTP_PORT ??= "1025";
    process.env.SMTP_USER ??= "moyu";
    process.env.SMTP_PASSWORD ??= "test-smtp-password";
    process.env.SMTP_FROM ??= "moyu@example.test";
  });

  afterEach(async () => {
    if (!emails.length) return;
    const database = getDatabaseClient();
    await database
      .delete(magicLinkTokens)
      .where(inArray(magicLinkTokens.email, emails));
    await database.delete(users).where(inArray(users.email, emails));
    emails.length = 0;
  });

  function email(): string {
    const value = `auth-${randomUUID()}@example.test`;
    emails.push(value);
    return value;
  }

  async function user() {
    return createUser({ email: email(), displayName: "Auth test account" });
  }

  return { email, user };
}

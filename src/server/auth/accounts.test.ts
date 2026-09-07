import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { useAuthDatabaseFixtures } from "@/test/auth-database";
import { getDatabaseClient } from "@/server/db/client";
import { credentials, users } from "@/server/db/schema";
import { registerAccount, authenticatePassword } from "./accounts";

const fixture = useAuthDatabaseFixtures();
it("normalizes registration/password emails and stores complete credentials atomically", async () => {
  const email = fixture.email();
  const input = {
    email: `  ${email.toUpperCase()}  `,
    password: "Synthetic secure password",
    displayName: "Test account",
  };
  const results = await Promise.allSettled([
    registerAccount(input),
    registerAccount(input),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rows = await getDatabaseClient()
    .select()
    .from(users)
    .innerJoin(credentials, eq(users.id, credentials.userId))
    .where(eq(users.email, email));
  expect(rows).toHaveLength(1);
  expect(rows[0].credentials.passwordHash).not.toContain(input.password);
  expect(
    (
      await authenticatePassword({
        email: input.email,
        password: input.password,
      })
    ).email,
  ).toBe(email);
  await expect(
    authenticatePassword({ email, password: "wrong password" }),
  ).rejects.toMatchObject({
    status: 401,
    message: "Invalid email or password.",
  });
  expect(
    await getDatabaseClient()
      .select()
      .from(users)
      .where(and(eq(users.email, email))),
  ).toHaveLength(1);
});

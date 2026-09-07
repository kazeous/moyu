import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { useAuthDatabaseFixtures } from "@/test/auth-database";
import { getDatabaseClient } from "@/server/db/client";
import { credentials } from "@/server/db/schema";

import { hashPassword, verifyPassword } from "./passwords";

const fixture = useAuthDatabaseFixtures();

describe("password hashes", () => {
  it("uses a unique salt and verifies the exact Unicode password", async () => {
    const password = "  Synthetic 密碼 mật khẩu  ";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(first.split("$")[5]).not.toBe(second.split("$")[5]);
    await expect(verifyPassword(password, first)).resolves.toBe(true);
    await expect(verifyPassword(password, second)).resolves.toBe(true);
    await expect(verifyPassword(password.trim(), first)).resolves.toBe(false);
    await expect(verifyPassword("wrong password", first)).resolves.toBe(false);
    await expect(verifyPassword(password, `${first}\n`)).resolves.toBe(false);
  });

  it("can persist and verify an adaptive credential without storing plaintext", async () => {
    const user = await fixture.user();
    const password = "synthetic-persisted-password";
    const passwordHash = await hashPassword(password);
    await getDatabaseClient()
      .insert(credentials)
      .values({ userId: user.id, passwordHash });
    const [stored] = await getDatabaseClient()
      .select()
      .from(credentials)
      .where(eq(credentials.userId, user.id));

    expect(stored.passwordHash).toMatch(
      /^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/,
    );
    expect(JSON.stringify(stored)).not.toContain(password);
    await expect(verifyPassword(password, stored.passwordHash)).resolves.toBe(
      true,
    );
  });

  it.each([
    "",
    "plaintext",
    `scrypt$v1$1073741824$8$1$${"ab".repeat(16)}$${"ab".repeat(64)}`,
    `scrypt$v1$131072$8$100000$${"ab".repeat(16)}$${"ab".repeat(64)}`,
    `scrypt$v1$2$8$1$${"ab".repeat(16)}$${"ab".repeat(64)}`,
    `scrypt$v1$131072$8$1$${"z".repeat(32)}$${"ab".repeat(64)}`,
    `scrypt$v1$131072$8$1$${"ab".repeat(16)}$ab`,
  ])("rejects malformed or unbounded stored hashes: %s", async (encoded) => {
    await expect(verifyPassword("synthetic-password", encoded)).resolves.toBe(
      false,
    );
  });

  it.each(["", "密".repeat(342)])(
    "rejects empty or excessive password bytes",
    async (password) => {
      await expect(hashPassword(password)).rejects.toThrow(
        "Password must be between 1 and 1024 UTF-8 bytes",
      );
      await expect(verifyPassword(password, "invalid")).resolves.toBe(false);
    },
  );
});

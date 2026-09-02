import { eq } from "drizzle-orm";
import { getDatabaseClient } from "@/server/db/client";
import { credentials, users } from "@/server/db/schema";
import { type User } from "@/server/db/repositories/users";
import { HttpError } from "@/server/http/response";
import { passwordGate } from "@/server/http/rate-limit";
import { signInInputSchema, signUpInputSchema } from "./contracts";
import { hashPassword, verifyPassword } from "./passwords";

export async function registerAccount(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<User> {
  const parsed = signUpInputSchema.parse(input);
  return passwordGate.run(async () => {
    const passwordHash = await hashPassword(parsed.password);
    return getDatabaseClient().transaction(async (transaction) => {
      const [user] = await transaction
        .insert(users)
        .values({ email: parsed.email, displayName: parsed.displayName })
        .onConflictDoNothing({ target: users.email })
        .returning();
      if (!user)
        throw new HttpError(
          409,
          "Unable to create account with these details.",
        );
      await transaction
        .insert(credentials)
        .values({ userId: user.id, passwordHash });
      return user;
    });
  });
}

export async function authenticatePassword(input: {
  email: string;
  password: string;
}): Promise<User> {
  const { email, password } = signInInputSchema.parse(input);
  return passwordGate.run(async () => {
    const [account] = await getDatabaseClient()
      .select({ user: users, passwordHash: credentials.passwordHash })
      .from(users)
      .innerJoin(credentials, eq(users.id, credentials.userId))
      .where(eq(users.email, email));
    const valid = account
      ? await verifyPassword(password, account.passwordHash)
      : (await hashPassword(password), false);
    if (!account || !valid)
      throw new HttpError(401, "Invalid email or password.");
    return account.user;
  });
}

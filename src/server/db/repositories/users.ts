import { eq } from "drizzle-orm";

import { getDatabaseClient } from "../client";
import { users } from "../schema";

export type User = typeof users.$inferSelect;

export async function createUser(input: {
  email: string;
  displayName: string;
}): Promise<User> {
  const [user] = await getDatabaseClient()
    .insert(users)
    .values(input)
    .returning();

  if (!user) {
    throw new Error("Unable to create user");
  }

  return user;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const [user] = await getDatabaseClient()
    .select()
    .from(users)
    .where(eq(users.email, email));

  return user ?? null;
}

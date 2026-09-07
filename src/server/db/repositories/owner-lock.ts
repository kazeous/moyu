import { eq } from "drizzle-orm";
import type { getDatabaseClient } from "../client";
import { users } from "../schema";

export type DatabaseTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]
>[0];

export async function lockOwnerMetadata(
  transaction: DatabaseTransaction,
  ownerId: string,
): Promise<void> {
  // Every phrase create/replacement and tag deletion takes this lock first.
  // A shared owner lock also serializes deletions of different tags; a per-tag
  // lock cannot protect a phrase that is concurrently losing both of its tags.
  await transaction
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ownerId))
    .for("update");
}

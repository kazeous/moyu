import { and, DrizzleQueryError, eq, sql } from "drizzle-orm";
import postgres from "postgres";

import {
  workTagInputSchema,
  type WorkTagInput,
} from "@/server/metadata-contract";
import { MetadataConflictError } from "@/server/metadata-conflict";

import { getDatabaseClient } from "../client";
import { customPhrases, phraseTags, workTags } from "../schema";
import { lockOwnerMetadata } from "./owner-lock";

export type WorkTag = typeof workTags.$inferSelect;

function rethrowWorkTagError(error: unknown): never {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (
    cause instanceof postgres.PostgresError &&
    cause.code === "23505" &&
    cause.constraint_name === "work_tags_owner_id_name_unique"
  ) {
    throw new MetadataConflictError(
      "A work tag with this name already exists.",
    );
  }
  throw error;
}

export async function listWorkTags(ownerId: string): Promise<WorkTag[]> {
  return getDatabaseClient()
    .select()
    .from(workTags)
    .where(eq(workTags.ownerId, ownerId));
}

export async function createWorkTag(
  ownerId: string,
  input: WorkTagInput,
): Promise<WorkTag> {
  const parsedInput = workTagInputSchema.parse(input);
  try {
    const [workTag] = await getDatabaseClient()
      .insert(workTags)
      .values({ ownerId, ...parsedInput })
      .returning();

    if (!workTag) {
      throw new Error("Unable to create work tag");
    }

    return workTag;
  } catch (error) {
    rethrowWorkTagError(error);
  }
}

export async function findWorkTagById(
  ownerId: string,
  workTagId: string,
): Promise<WorkTag | null> {
  const [workTag] = await getDatabaseClient()
    .select()
    .from(workTags)
    .where(and(eq(workTags.ownerId, ownerId), eq(workTags.id, workTagId)));

  return workTag ?? null;
}

export async function updateWorkTag(
  ownerId: string,
  workTagId: string,
  input: WorkTagInput,
): Promise<WorkTag | null> {
  const parsedInput = workTagInputSchema.parse(input);
  try {
    const [workTag] = await getDatabaseClient()
      .update(workTags)
      .set({ ...parsedInput, updatedAt: new Date() })
      .where(and(eq(workTags.ownerId, ownerId), eq(workTags.id, workTagId)))
      .returning();

    return workTag ?? null;
  } catch (error) {
    rethrowWorkTagError(error);
  }
}

export async function deleteWorkTag(
  ownerId: string,
  workTagId: string,
): Promise<boolean> {
  return getDatabaseClient().transaction(async (transaction) => {
    await lockOwnerMetadata(transaction, ownerId);
    const [tag] = await transaction
      .select({ id: workTags.id })
      .from(workTags)
      .where(and(eq(workTags.ownerId, ownerId), eq(workTags.id, workTagId)));
    if (!tag) return false;

    const [finalTagPhrase] = await transaction
      .select({ id: customPhrases.id })
      .from(customPhrases)
      .innerJoin(phraseTags, eq(phraseTags.phraseId, customPhrases.id))
      .innerJoin(workTags, eq(workTags.id, phraseTags.tagId))
      .where(
        and(eq(customPhrases.ownerId, ownerId), eq(workTags.ownerId, ownerId)),
      )
      .groupBy(customPhrases.id)
      .having(sql`count(*) = 1 and bool_or(${workTags.id} = ${workTagId})`)
      .limit(1);

    if (finalTagPhrase) {
      throw new MetadataConflictError(
        "A phrase must keep at least one work tag.",
      );
    }

    const deleted = await transaction
      .delete(workTags)
      .where(and(eq(workTags.ownerId, ownerId), eq(workTags.id, workTagId)))
      .returning({ id: workTags.id });

    return deleted.length === 1;
  });
}

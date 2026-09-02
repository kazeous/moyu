import { and, eq } from "drizzle-orm";

import {
  workTagInputSchema,
  type WorkTagInput,
} from "@/server/metadata-contract";

import { getDatabaseClient } from "../client";
import { workTags } from "../schema";

export type WorkTag = typeof workTags.$inferSelect;

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
  const [workTag] = await getDatabaseClient()
    .insert(workTags)
    .values({ ownerId, ...parsedInput })
    .returning();

  if (!workTag) {
    throw new Error("Unable to create work tag");
  }

  return workTag;
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
  const [workTag] = await getDatabaseClient()
    .update(workTags)
    .set({ ...parsedInput, updatedAt: new Date() })
    .where(and(eq(workTags.ownerId, ownerId), eq(workTags.id, workTagId)))
    .returning();

  return workTag ?? null;
}

export async function deleteWorkTag(
  ownerId: string,
  workTagId: string,
): Promise<boolean> {
  const deleted = await getDatabaseClient()
    .delete(workTags)
    .where(and(eq(workTags.ownerId, ownerId), eq(workTags.id, workTagId)))
    .returning({ id: workTags.id });

  return deleted.length === 1;
}

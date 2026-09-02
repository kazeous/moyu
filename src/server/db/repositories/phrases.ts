import { and, eq, inArray } from "drizzle-orm";

import {
  createPhraseInputSchema,
  type CreatePhraseInput,
} from "@/server/metadata-contract";

import { getDatabaseClient } from "../client";
import { customPhrases, phraseGlosses, phraseTags, workTags } from "../schema";
import type { WorkTag } from "./work-tags";

type PhraseGloss = Pick<typeof phraseGlosses.$inferSelect, "language" | "text">;

export type CustomPhrase = typeof customPhrases.$inferSelect & {
  glosses: PhraseGloss[];
  workTags: WorkTag[];
};

async function phraseWithMetadata(
  ownerId: string,
  phraseId: string,
): Promise<CustomPhrase | null> {
  const database = getDatabaseClient();
  const [phrase] = await database
    .select()
    .from(customPhrases)
    .where(
      and(eq(customPhrases.ownerId, ownerId), eq(customPhrases.id, phraseId)),
    );

  if (!phrase) {
    return null;
  }

  const [glosses, tags] = await Promise.all([
    database
      .select({ language: phraseGlosses.language, text: phraseGlosses.text })
      .from(phraseGlosses)
      .where(eq(phraseGlosses.phraseId, phrase.id)),
    database
      .select({
        id: workTags.id,
        ownerId: workTags.ownerId,
        name: workTags.name,
        aliases: workTags.aliases,
        createdAt: workTags.createdAt,
        updatedAt: workTags.updatedAt,
      })
      .from(phraseTags)
      .innerJoin(workTags, eq(phraseTags.tagId, workTags.id))
      .where(
        and(eq(phraseTags.phraseId, phrase.id), eq(workTags.ownerId, ownerId)),
      ),
  ]);

  return { ...phrase, glosses, workTags: tags };
}

export async function listPhrases(ownerId: string): Promise<CustomPhrase[]> {
  const phraseRows = await getDatabaseClient()
    .select({ id: customPhrases.id })
    .from(customPhrases)
    .where(eq(customPhrases.ownerId, ownerId));

  const phrases = await Promise.all(
    phraseRows.map(({ id }) => phraseWithMetadata(ownerId, id)),
  );

  return phrases.filter((phrase): phrase is CustomPhrase => phrase !== null);
}

export async function findPhraseById(
  ownerId: string,
  phraseId: string,
): Promise<CustomPhrase | null> {
  return phraseWithMetadata(ownerId, phraseId);
}

export async function createPhrase(
  ownerId: string,
  input: CreatePhraseInput,
): Promise<CustomPhrase> {
  const parsedInput = createPhraseInputSchema.parse(input);
  const uniqueTagIds = [...new Set(parsedInput.workTagIds)];
  const database = getDatabaseClient();

  return database.transaction(async (transaction) => {
    const tags =
      uniqueTagIds.length === 0
        ? []
        : await transaction
            .select()
            .from(workTags)
            .where(
              and(
                eq(workTags.ownerId, ownerId),
                inArray(workTags.id, uniqueTagIds),
              ),
            );

    if (tags.length !== uniqueTagIds.length) {
      throw new Error("Work tags must belong to the phrase owner");
    }

    const [phrase] = await transaction
      .insert(customPhrases)
      .values({
        ownerId,
        sourcePhrase: parsedInput.sourcePhrase,
        language: parsedInput.language,
        note: parsedInput.note,
        matchingMode: "exact",
      })
      .returning();

    if (!phrase) {
      throw new Error("Unable to create phrase");
    }

    await transaction
      .insert(phraseGlosses)
      .values(
        parsedInput.glosses.map((gloss) => ({ ...gloss, phraseId: phrase.id })),
      );

    if (uniqueTagIds.length > 0) {
      await transaction
        .insert(phraseTags)
        .values(uniqueTagIds.map((tagId) => ({ phraseId: phrase.id, tagId })));
    }

    return { ...phrase, glosses: parsedInput.glosses, workTags: tags };
  });
}

export async function updatePhrase(
  ownerId: string,
  phraseId: string,
  input: CreatePhraseInput,
): Promise<CustomPhrase | null> {
  const parsedInput = createPhraseInputSchema.parse(input);
  const uniqueTagIds = [...new Set(parsedInput.workTagIds)];
  const database = getDatabaseClient();

  return database.transaction(async (transaction) => {
    const [existingPhrase] = await transaction
      .select({ id: customPhrases.id })
      .from(customPhrases)
      .where(
        and(eq(customPhrases.ownerId, ownerId), eq(customPhrases.id, phraseId)),
      );

    if (!existingPhrase) {
      return null;
    }

    const tags =
      uniqueTagIds.length === 0
        ? []
        : await transaction
            .select()
            .from(workTags)
            .where(
              and(
                eq(workTags.ownerId, ownerId),
                inArray(workTags.id, uniqueTagIds),
              ),
            );

    if (tags.length !== uniqueTagIds.length) {
      throw new Error("Work tags must belong to the phrase owner");
    }

    const [phrase] = await transaction
      .update(customPhrases)
      .set({
        sourcePhrase: parsedInput.sourcePhrase,
        language: parsedInput.language,
        note: parsedInput.note,
        matchingMode: "exact",
        updatedAt: new Date(),
      })
      .where(eq(customPhrases.id, existingPhrase.id))
      .returning();

    if (!phrase) {
      throw new Error("Unable to update phrase");
    }

    await transaction
      .delete(phraseGlosses)
      .where(eq(phraseGlosses.phraseId, phraseId));
    await transaction
      .delete(phraseTags)
      .where(eq(phraseTags.phraseId, phraseId));
    await transaction
      .insert(phraseGlosses)
      .values(
        parsedInput.glosses.map((gloss) => ({ ...gloss, phraseId: phrase.id })),
      );

    if (uniqueTagIds.length > 0) {
      await transaction
        .insert(phraseTags)
        .values(uniqueTagIds.map((tagId) => ({ phraseId: phrase.id, tagId })));
    }

    return { ...phrase, glosses: parsedInput.glosses, workTags: tags };
  });
}

export async function deletePhrase(
  ownerId: string,
  phraseId: string,
): Promise<boolean> {
  const deleted = await getDatabaseClient()
    .delete(customPhrases)
    .where(
      and(eq(customPhrases.ownerId, ownerId), eq(customPhrases.id, phraseId)),
    )
    .returning({ id: customPhrases.id });

  return deleted.length === 1;
}

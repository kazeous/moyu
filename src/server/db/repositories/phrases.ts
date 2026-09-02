import { and, eq, inArray } from "drizzle-orm";

import {
  createPhraseInputSchema,
  type CreatePhraseInput,
} from "@/server/metadata-contract";

import { getDatabaseClient } from "../client";
import { customPhrases, phraseGlosses, phraseTags, workTags } from "../schema";
import type { WorkTag } from "./work-tags";
import { lockOwnerMetadata, type DatabaseTransaction } from "./owner-lock";

type PhraseGloss = Pick<typeof phraseGlosses.$inferSelect, "language" | "text">;

export type CustomPhrase = typeof customPhrases.$inferSelect & {
  glosses: PhraseGloss[];
  workTags: WorkTag[];
};

async function findOwnerWorkTags(
  transaction: DatabaseTransaction,
  ownerId: string,
  workTagIds: string[],
): Promise<WorkTag[]> {
  if (workTagIds.length === 0) {
    return [];
  }

  const tags = await transaction
    .select()
    .from(workTags)
    .where(
      and(eq(workTags.ownerId, ownerId), inArray(workTags.id, workTagIds)),
    );

  if (tags.length !== workTagIds.length) {
    throw new Error("Work tags must belong to the phrase owner");
  }

  return tags;
}

function ownerScopedPhraseIds(
  transaction: DatabaseTransaction,
  ownerId: string,
  phraseId: string,
) {
  return transaction
    .select({ id: customPhrases.id })
    .from(customPhrases)
    .where(
      and(eq(customPhrases.ownerId, ownerId), eq(customPhrases.id, phraseId)),
    );
}

async function replacePhraseRelationships(
  transaction: DatabaseTransaction,
  ownerId: string,
  phraseId: string,
  input: CreatePhraseInput,
  workTagIds: string[],
): Promise<void> {
  await transaction
    .delete(phraseGlosses)
    .where(
      inArray(
        phraseGlosses.phraseId,
        ownerScopedPhraseIds(transaction, ownerId, phraseId),
      ),
    );
  await transaction
    .delete(phraseTags)
    .where(
      inArray(
        phraseTags.phraseId,
        ownerScopedPhraseIds(transaction, ownerId, phraseId),
      ),
    );
  await transaction
    .insert(phraseGlosses)
    .values(input.glosses.map((gloss) => ({ ...gloss, phraseId })));

  if (workTagIds.length > 0) {
    await transaction
      .insert(phraseTags)
      .values(workTagIds.map((tagId) => ({ phraseId, tagId })));
  }
}

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
      .innerJoin(customPhrases, eq(phraseGlosses.phraseId, customPhrases.id))
      .where(
        and(
          eq(customPhrases.ownerId, ownerId),
          eq(customPhrases.id, phrase.id),
        ),
      ),
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
    await lockOwnerMetadata(transaction, ownerId);
    const tags = await findOwnerWorkTags(transaction, ownerId, uniqueTagIds);

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

    await replacePhraseRelationships(
      transaction,
      ownerId,
      phrase.id,
      parsedInput,
      uniqueTagIds,
    );

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
    await lockOwnerMetadata(transaction, ownerId);
    const [existingPhrase] = await transaction
      .select({ id: customPhrases.id })
      .from(customPhrases)
      .where(
        and(eq(customPhrases.ownerId, ownerId), eq(customPhrases.id, phraseId)),
      );

    if (!existingPhrase) {
      return null;
    }

    const tags = await findOwnerWorkTags(transaction, ownerId, uniqueTagIds);

    const [phrase] = await transaction
      .update(customPhrases)
      .set({
        sourcePhrase: parsedInput.sourcePhrase,
        language: parsedInput.language,
        note: parsedInput.note ?? null,
        matchingMode: "exact",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customPhrases.ownerId, ownerId),
          eq(customPhrases.id, existingPhrase.id),
        ),
      )
      .returning();

    if (!phrase) {
      throw new Error("Unable to update phrase");
    }

    await replacePhraseRelationships(
      transaction,
      ownerId,
      phrase.id,
      parsedInput,
      uniqueTagIds,
    );

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

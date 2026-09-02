import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { getDatabaseClient } from "../client";
import { users } from "../schema";
import { createUser } from "./users";
import {
  createPhrase,
  deletePhrase,
  findPhraseById,
  listPhrases,
  updatePhrase,
} from "./phrases";
import {
  createWorkTag,
  deleteWorkTag,
  findWorkTagById,
  updateWorkTag,
} from "./work-tags";
import { getUserSettings, updateUserSettings } from "./user-settings";

const fixtureUserIds: string[] = [];

function fixtureEmail(): string {
  return `metadata-${randomUUID()}@example.test`;
}

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
  const database = getDatabaseClient();

  for (const userId of fixtureUserIds.splice(0)) {
    await database.delete(users).where(eq(users.id, userId));
  }
});

describe("private metadata repositories", () => {
  it("does not expose another owner's tags, phrases, or settings", async () => {
    const owner = await createUser({
      email: fixtureEmail(),
      displayName: "Owner",
    });
    const otherOwner = await createUser({
      email: fixtureEmail(),
      displayName: "Other owner",
    });
    fixtureUserIds.push(owner.id, otherOwner.id);

    const tag = await createWorkTag(owner.id, { name: "mecha", aliases: [] });
    const phrase = await createPhrase(owner.id, {
      sourcePhrase: "第一架",
      language: "zh",
      glosses: [{ language: "en", text: "first unit" }],
      workTagIds: [tag.id],
    });
    await updateUserSettings(owner.id, { theme: "dark" });

    await expect(findWorkTagById(otherOwner.id, tag.id)).resolves.toBeNull();
    await expect(findPhraseById(otherOwner.id, phrase.id)).resolves.toBeNull();
    await expect(getUserSettings(otherOwner.id)).resolves.toBeNull();
    await expect(
      updateWorkTag(otherOwner.id, tag.id, { name: "changed", aliases: [] }),
    ).resolves.toBeNull();
    await expect(deleteWorkTag(otherOwner.id, tag.id)).resolves.toBe(false);
    await expect(
      updatePhrase(otherOwner.id, phrase.id, {
        sourcePhrase: "第二架",
        language: "zh",
        glosses: [{ language: "en", text: "second unit" }],
        workTagIds: [],
      }),
    ).resolves.toBeNull();
    await expect(deletePhrase(otherOwner.id, phrase.id)).resolves.toBe(false);

    await expect(findWorkTagById(owner.id, tag.id)).resolves.toMatchObject({
      name: "mecha",
    });
    await expect(findPhraseById(owner.id, phrase.id)).resolves.toMatchObject({
      sourcePhrase: "第一架",
      glosses: [{ language: "en", text: "first unit" }],
    });
    await expect(getUserSettings(owner.id)).resolves.toEqual({
      theme: "dark",
      interfaceLanguage: "en",
    });
  });

  it("rolls back a phrase write with a tag from another owner", async () => {
    const owner = await createUser({
      email: fixtureEmail(),
      displayName: "Owner",
    });
    const otherOwner = await createUser({
      email: fixtureEmail(),
      displayName: "Other owner",
    });
    fixtureUserIds.push(owner.id, otherOwner.id);

    const ownedTag = await createWorkTag(owner.id, {
      name: "owned",
      aliases: [],
    });
    const foreignTag = await createWorkTag(otherOwner.id, {
      name: "foreign",
      aliases: [],
    });

    await expect(
      createPhrase(owner.id, {
        sourcePhrase: "第一架",
        language: "zh",
        glosses: [{ language: "en", text: "first unit" }],
        workTagIds: [ownedTag.id, foreignTag.id],
      }),
    ).rejects.toThrow("Work tags must belong to the phrase owner");

    await expect(listPhrases(owner.id)).resolves.toEqual([]);
  });

  it("leaves a phrase unchanged when an update includes another owner's tag", async () => {
    const owner = await createUser({
      email: fixtureEmail(),
      displayName: "Owner",
    });
    const otherOwner = await createUser({
      email: fixtureEmail(),
      displayName: "Other owner",
    });
    fixtureUserIds.push(owner.id, otherOwner.id);

    const ownedTag = await createWorkTag(owner.id, {
      name: "owned",
      aliases: [],
    });
    const foreignTag = await createWorkTag(otherOwner.id, {
      name: "foreign",
      aliases: [],
    });
    const phrase = await createPhrase(owner.id, {
      sourcePhrase: "第一架",
      language: "zh",
      glosses: [{ language: "en", text: "first unit" }],
      workTagIds: [ownedTag.id],
    });

    await expect(
      updatePhrase(owner.id, phrase.id, {
        sourcePhrase: "第二架",
        language: "zh",
        glosses: [{ language: "en", text: "second unit" }],
        workTagIds: [ownedTag.id, foreignTag.id],
      }),
    ).rejects.toThrow("Work tags must belong to the phrase owner");

    await expect(findPhraseById(owner.id, phrase.id)).resolves.toMatchObject({
      sourcePhrase: "第一架",
      glosses: [{ language: "en", text: "first unit" }],
      workTags: [{ id: ownedTag.id }],
    });
  });
});

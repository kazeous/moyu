import { expect, it } from "vitest";

import { useAuthDatabaseFixtures } from "@/test/auth-database";
import { getDatabaseClient } from "../client";
import {
  createPhrase,
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

const fixture = useAuthDatabaseFixtures();
const phraseInput = {
  sourcePhrase: "第一架",
  language: "zh" as const,
  note: "Synthetic note",
  glosses: [{ language: "en" as const, text: "first unit" }],
};

async function tagsForOwner() {
  const owner = await fixture.user();
  const first = await createWorkTag(owner.id, { name: "First", aliases: [] });
  const second = await createWorkTag(owner.id, { name: "Second", aliases: [] });
  return { owner, first, second };
}

it("rejects deleting a phrase's only tag without changing any metadata", async () => {
  const { owner, first } = await tagsForOwner();
  const phrase = await createPhrase(owner.id, {
    ...phraseInput,
    workTagIds: [first.id],
  });
  await expect(deleteWorkTag(owner.id, first.id)).rejects.toThrow(
    "A phrase must keep at least one work tag.",
  );
  expect(await findPhraseById(owner.id, phrase.id)).toEqual(phrase);
  expect(await findWorkTagById(owner.id, first.id)).toEqual(first);
});

it("allows unused and multi-tag deletion while retaining the remaining phrase metadata", async () => {
  const { owner, first, second } = await tagsForOwner();
  const unused = await createWorkTag(owner.id, { name: "Unused", aliases: [] });
  const phrase = await createPhrase(owner.id, {
    ...phraseInput,
    workTagIds: [first.id, second.id],
  });
  expect(await deleteWorkTag(owner.id, unused.id)).toBe(true);
  expect(await deleteWorkTag(owner.id, first.id)).toBe(true);
  expect(await findWorkTagById(owner.id, unused.id)).toBeNull();
  expect(await findWorkTagById(owner.id, first.id)).toBeNull();
  expect(await findPhraseById(owner.id, phrase.id)).toEqual({
    ...phrase,
    workTags: [second],
  });
});

// Queue real writes behind a held owner row. This proves every participating
// operation uses the same transaction protocol, including different tag IDs.
async function raceOwnerWrites(
  ownerId: string,
  operations: (() => Promise<unknown>)[],
) {
  const client = getDatabaseClient().$client;
  const blocker = await client.reserve();
  let results: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await blocker`begin`;
    const [connection] = await blocker`select pg_backend_pid() as pid`;
    await blocker`select id from users where id = ${ownerId} for update`;
    results = Promise.allSettled(operations.map((operation) => operation()));
    await expect
      .poll(
        async () => {
          const [row] = await client`
        with recursive blocked(pid) as (
          select ${connection.pid}::integer
          union
          select activity.pid from pg_stat_activity activity
          join blocked on blocked.pid = any(pg_blocking_pids(activity.pid))
        )
        select count(*)::int - 1 as waiting from blocked
      `;
          return row.waiting;
        },
        { timeout: 1500 },
      )
      .toBe(operations.length);
  } finally {
    await blocker`rollback`;
    blocker.release();
    // Settle in-flight writes before fixture cleanup, including failed assertions.
    await results;
  }
  return results!;
}

it("serializes two different concurrent tag deletions so exactly one tag survives", async () => {
  const { owner, first, second } = await tagsForOwner();
  const phrase = await createPhrase(owner.id, {
    ...phraseInput,
    workTagIds: [first.id, second.id],
  });
  const outcomes = await raceOwnerWrites(owner.id, [
    () => deleteWorkTag(owner.id, first.id),
    () => deleteWorkTag(owner.id, second.id),
  ]);
  expect(
    outcomes.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    outcomes.filter((result) => result.status === "rejected"),
  ).toHaveLength(1);
  const stored = await findPhraseById(owner.id, phrase.id);
  expect(stored?.workTags).toHaveLength(1);
  expect(stored?.glosses).toEqual(phraseInput.glosses);
});

it("serializes tag deletion racing phrase creation without committing an untagged phrase", async () => {
  const { owner, first } = await tagsForOwner();
  const outcomes = await raceOwnerWrites(owner.id, [
    () => createPhrase(owner.id, { ...phraseInput, workTagIds: [first.id] }),
    () => deleteWorkTag(owner.id, first.id),
  ]);
  expect(
    outcomes.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const phrases = await listPhrases(owner.id);
  if (outcomes[0].status === "fulfilled") {
    expect(phrases).toHaveLength(1);
    expect(phrases[0].workTags.map((tag) => tag.id)).toEqual([first.id]);
  } else {
    expect(phrases).toEqual([]);
    expect(await findWorkTagById(owner.id, first.id)).toBeNull();
  }
});

it("serializes tag deletion racing phrase replacement without losing the final tag", async () => {
  const { owner, first, second } = await tagsForOwner();
  const phrase = await createPhrase(owner.id, {
    ...phraseInput,
    workTagIds: [first.id, second.id],
  });
  const outcomes = await raceOwnerWrites(owner.id, [
    () =>
      updatePhrase(owner.id, phrase.id, {
        ...phraseInput,
        note: "Replacement",
        workTagIds: [first.id],
      }),
    () => deleteWorkTag(owner.id, first.id),
  ]);
  expect(
    outcomes.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const stored = await findPhraseById(owner.id, phrase.id);
  expect(stored?.workTags.map((tag) => tag.id)).toEqual([
    outcomes[0].status === "fulfilled" ? first.id : second.id,
  ]);
  expect(stored?.note).toBe(
    outcomes[0].status === "fulfilled" ? "Replacement" : "Synthetic note",
  );
  expect(stored?.glosses).toEqual(phraseInput.glosses);
});

it("reports duplicate normalized names as a conflict and permits the same name for another owner", async () => {
  const { owner, first } = await tagsForOwner();
  await expect(
    createWorkTag(owner.id, { name: " First ", aliases: [] }),
  ).rejects.toThrow("A work tag with this name already exists.");
  expect(await findWorkTagById(owner.id, first.id)).toEqual(first);
  const other = await fixture.user();
  await expect(
    createWorkTag(other.id, { name: "First", aliases: [] }),
  ).resolves.toMatchObject({ name: "First", ownerId: other.id });
});

it("preserves a tag on rename collision and allows renaming to its unchanged name", async () => {
  const { owner, first, second } = await tagsForOwner();
  await expect(
    updateWorkTag(owner.id, second.id, {
      name: first.name,
      aliases: ["changed"],
    }),
  ).rejects.toThrow("A work tag with this name already exists.");
  expect(await findWorkTagById(owner.id, second.id)).toEqual(second);
  await expect(
    updateWorkTag(owner.id, first.id, {
      name: first.name,
      aliases: ["same name"],
    }),
  ).resolves.toMatchObject({ name: first.name, aliases: ["same name"] });
});

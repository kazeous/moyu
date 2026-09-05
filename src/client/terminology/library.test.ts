import { IDBFactory } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { createLocalSessionStore } from "../workspace/session-store";
import { confirmedPhraseSchema } from "./contracts";
import { createPendingPhraseStore } from "./pending-store";
import { createPersonalLibrary } from "./library";

const owner = "11111111-1111-4111-8111-111111111111";
const tag = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Work",
  aliases: [],
};
const input = {
  sourcePhrase: "第一架",
  language: "zh" as const,
  glosses: [{ language: "en" as const, text: "first unit" }],
  workTagIds: [tag.id],
};
function fixture() {
  const idb = new IDBFactory();
  const store = createPendingPhraseStore(idb);
  let fail = true;
  let identity = owner;
  const posts: RequestInit[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/me")
      return Response.json({ id: identity, displayName: "Editor" });
    if (url === "/api/me/work-tags") return Response.json([tag]);
    if (init?.method === "POST") {
      posts.push(init);
      if (fail) throw new Error("offline");
      const id = new Headers(init.headers).get("Idempotency-Key");
      return Response.json(
        {
          id,
          ...input,
          workTagIds: undefined,
          note: null,
          matchingMode: "exact",
          workTags: [tag],
        },
        { status: 201 },
      );
    }
    return Response.json([]);
  });
  return {
    store,
    idb,
    posts,
    fetcher,
    library: createPersonalLibrary({ fetcher, store }),
    succeed() {
      fail = false;
    },
    switchOwner() {
      identity = "33333333-3333-4333-8333-333333333333";
    },
  };
}

async function rawPendingRecord(idb: IDBFactory, id: string, value?: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = idb.open("moyu-personal-library", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction(
        "pending-phrases",
        value === undefined ? "readonly" : "readwrite",
      );
      const store = transaction.objectStore("pending-phrases");
      const request = value === undefined ? store.get(id) : store.put(value);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

it("loads valid owned edits alongside retained unreadable records and recovers after local repair", async () => {
  const f = fixture();
  await f.library.load();
  await f.library.savePhrase(input);
  const foreignId = crypto.randomUUID();
  const corrupt = {
    id: foreignId,
    ownerId: "33333333-3333-4333-8333-333333333333",
    input: { ...input, glosses: "unreadable" },
  };
  await rawPendingRecord(f.idb, foreignId, corrupt);
  const reloaded = createPersonalLibrary({
    fetcher: f.fetcher,
    store: createPendingPhraseStore(f.idb),
  });
  await reloaded.load();
  expect(reloaded.getSnapshot().account?.id).toBe(owner);
  expect(reloaded.getSnapshot().pending).toHaveLength(1);
  expect(reloaded.getSnapshot().pendingWarning).toContain("cannot be read");
  expect(await rawPendingRecord(f.idb, foreignId)).toEqual(corrupt);
  f.succeed();
  await reloaded.retryPhrase(reloaded.getSnapshot().pending[0].id);
  expect(reloaded.getSnapshot().pending).toEqual([]);
  expect(reloaded.getSnapshot().pendingWarning).toContain("cannot be read");
  expect(await rawPendingRecord(f.idb, foreignId)).toEqual(corrupt);
  await rawPendingRecord(f.idb, foreignId, { ...corrupt, input });
  const requestCount = f.fetcher.mock.calls.length;
  await reloaded.recheckPending();
  expect(f.fetcher).toHaveBeenCalledTimes(requestCount);
  expect(reloaded.getSnapshot().pendingWarning).toBeNull();
});

it("retains an unreadable own edit and restores it on explicit local recheck", async () => {
  const f = fixture();
  await f.library.load();
  const id = crypto.randomUUID();
  const corrupt = {
    id,
    ownerId: owner,
    input: { ...input, language: "invalid" },
  };
  await rawPendingRecord(f.idb, id, corrupt);
  await f.library.load();
  expect(f.library.getSnapshot().account?.id).toBe(owner);
  expect(f.library.getSnapshot().pendingWarning).toContain("cannot be read");
  expect(f.library.getSnapshot().pending).toEqual([]);
  expect(await rawPendingRecord(f.idb, id)).toEqual(corrupt);
  await rawPendingRecord(f.idb, id, { ...corrupt, input });
  await f.library.recheckPending();
  expect(f.library.getSnapshot().pending).toMatchObject([{ id, input }]);
  expect(f.library.getSnapshot().pendingWarning).toBeNull();
  expect(f.posts).toHaveLength(0);
});
it("strictly rejects review fields, including inside glosses", () => {
  for (const value of [
    { ...input, dialogue: "private" },
    { ...input, selection: {} },
    { ...input, glosses: [{ ...input.glosses[0], reference: "private" }] },
  ])
    expect(confirmedPhraseSchema.safeParse(value).success).toBe(false);
});
it("has no requests before explicit load and POST sends only confirmed metadata", async () => {
  const f = fixture();
  expect(f.fetcher).not.toHaveBeenCalled();
  await f.library.load();
  await f.library.savePhrase(input);
  expect(JSON.parse(f.posts[0].body as string)).toEqual(input);
  expect(new Headers(f.posts[0].headers).get("X-Moyu-Owner")).toBe(owner);
});
it("persists failed edits before POST, survives reload and Clear session, and retries the same key", async () => {
  const f = fixture();
  await f.library.load();
  await f.library.savePhrase(input);
  expect(f.library.getSnapshot().pending).toHaveLength(1);
  await createLocalSessionStore(f.idb).clearReviewContent();
  const reloaded = createPersonalLibrary({
    fetcher: f.fetcher,
    store: createPendingPhraseStore(f.idb),
  });
  await reloaded.load();
  const pending = reloaded.getSnapshot().pending[0];
  expect(pending.input).toEqual(input);
  f.succeed();
  await reloaded.retryPhrase(pending.id);
  expect(f.posts).toHaveLength(2);
  expect(new Headers(f.posts[1].headers).get("Idempotency-Key")).toBe(
    new Headers(f.posts[0].headers).get("Idempotency-Key"),
  );
  expect((await f.store.list(owner)).pending).toEqual([]);
  expect(reloaded.getSnapshot().phrases).toHaveLength(1);
});
it("does not send pending phrase content when identity changes", async () => {
  const f = fixture();
  await f.library.load();
  await f.library.savePhrase(input);
  f.switchOwner();
  await f.library.retryPhrase(f.library.getSnapshot().pending[0].id);
  expect(f.posts).toHaveLength(1);
  expect((await f.store.list(owner)).pending).toHaveLength(1);
  expect(f.library.getSnapshot().status).toBe("account-changed");
});
it("does not send a phrase when durable local storage is unavailable", async () => {
  const f = fixture();
  const library = createPersonalLibrary({
    fetcher: f.fetcher,
    store: createPendingPhraseStore(undefined),
  });
  await library.load();
  await library.savePhrase(input);
  expect(f.posts).toHaveLength(0);
});

it("does not send metadata if storage fails after the library was loaded", async () => {
  const f = fixture();
  await f.library.load();
  vi.spyOn(f.store, "put").mockRejectedValue(new Error("storage full"));
  await f.library.savePhrase(input);
  expect(f.posts).toHaveLength(0);
  expect(f.library.getSnapshot().status).toBe("unavailable");
});

it("uses the pending key when an unchanged failed form is saved again", async () => {
  const f = fixture();
  await f.library.load();
  await f.library.savePhrase(input);
  f.succeed();
  await f.library.savePhrase(input);
  expect(new Headers(f.posts[1].headers).get("Idempotency-Key")).toBe(
    new Headers(f.posts[0].headers).get("Idempotency-Key"),
  );
  expect((await f.store.list(owner)).pending).toEqual([]);
});

it("reuses the pending key when equivalent tags and glosses are reordered after response loss", async () => {
  const f = fixture();
  const secondTag = "44444444-4444-4444-8444-444444444444";
  const confirmed = {
    ...input,
    workTagIds: [tag.id, secondTag],
    glosses: [
      ...input.glosses,
      { language: "vi" as const, text: "đơn vị đầu tiên" },
    ],
  };
  await f.library.load();
  await f.library.savePhrase(confirmed);
  f.succeed();
  await f.library.savePhrase({
    ...confirmed,
    workTagIds: [secondTag, tag.id, secondTag],
    glosses: [...confirmed.glosses].reverse(),
  });
  expect(new Headers(f.posts[1].headers).get("Idempotency-Key")).toBe(
    new Headers(f.posts[0].headers).get("Idempotency-Key"),
  );
  expect((await f.store.list(owner)).pending).toEqual([]);
});

it("keeps pending edits isolated when loading another account", async () => {
  const f = fixture();
  await f.library.load();
  await f.library.savePhrase(input);
  const pendingId = f.library.getSnapshot().pending[0].id;
  f.switchOwner();
  await f.library.load();
  expect(f.library.getSnapshot().pending).toEqual([]);
  await f.library.retryPhrase(pendingId);
  expect(f.posts).toHaveLength(1);
  expect((await f.store.list(owner)).pending).toHaveLength(1);
});

it("ignores an obsolete load completing after a newer account load", async () => {
  const f = fixture();
  let release!: (response: Response) => void;
  const delayed = new Promise<Response>((resolve) => {
    release = resolve;
  });
  f.fetcher.mockImplementationOnce(() => delayed);
  const oldLoad = f.library.load();
  f.switchOwner();
  await f.library.load();
  release(Response.json({ id: owner, displayName: "Old editor" }));
  await oldLoad;
  expect(f.library.getSnapshot().account?.displayName).toBe("Editor");
  expect(f.library.getSnapshot().account?.id).not.toBe(owner);
});

it("rejects malformed IndexedDB and HTTP records", async () => {
  const f = fixture();
  f.fetcher.mockImplementationOnce(async () =>
    Response.json({ id: owner, displayName: "Editor", dialogue: "private" }),
  );
  await f.library.load();
  expect(f.library.getSnapshot().status).toBe("unavailable");
  await expect(
    f.store.put({
      id: crypto.randomUUID(),
      ownerId: owner,
      input: { ...input, dialogue: "private" },
    } as never),
  ).rejects.toThrow();
  expect((await f.store.list(owner)).pending).toEqual([]);
});

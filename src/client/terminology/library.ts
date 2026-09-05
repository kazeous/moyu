import { z } from "zod";
import {
  libraryRequest,
  LibraryRequestError,
  type LibraryFetcher,
} from "./api";
import {
  accountSchema,
  confirmedPhraseSchema,
  phraseSchema,
  tagInputSchema,
  tagSchema,
  type Account,
  type ConfirmedPhrase,
  type PendingPhrase,
  type PersonalPhrase,
  type PersonalTag,
} from "./contracts";
import type { PendingPhraseStore } from "./pending-store";

export type LibrarySnapshot = {
  status: "idle" | "ready" | "sign-in" | "unavailable" | "account-changed";
  busy: boolean;
  message: string;
  account: Account | null;
  phrases: PersonalPhrase[];
  tags: PersonalTag[];
  pending: PendingPhrase[];
};

export function createPersonalLibrary({
  fetcher,
  store,
}: {
  fetcher: LibraryFetcher;
  store: PendingPhraseStore;
}) {
  let snapshot: LibrarySnapshot = {
    status: "idle",
    busy: false,
    message: "Load your personal library to use saved phrases.",
    account: null,
    phrases: [],
    tags: [],
    pending: [],
  };
  const listeners = new Set<() => void>();
  let generation = 0;
  const update = (patch: Partial<LibrarySnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const request = <T>(
    url: string,
    schema: z.ZodType<T>,
    ownerId?: string,
    init?: RequestInit,
  ) => libraryRequest(fetcher, url, schema, ownerId, init);
  const changed = () => new LibraryRequestError(412);
  async function verifyOwner(ownerId: string) {
    try {
      const current = await request("/api/me", accountSchema, ownerId);
      if (current.id !== ownerId) throw changed();
    } catch (error) {
      if (error instanceof LibraryRequestError && error.status === 409)
        throw changed();
      throw error;
    }
  }
  function failure(error: unknown) {
    const status =
      error instanceof LibraryRequestError && error.status === 401
        ? "sign-in"
        : error instanceof LibraryRequestError && error.status === 412
          ? "account-changed"
          : "unavailable";
    update({
      status,
      busy: false,
      message:
        status === "sign-in"
          ? "Sign in to load your personal library. Unsynced phrases remain on this device."
          : status === "account-changed"
            ? "Account changed. Load your personal library again. Unsynced edits remain with their original account."
            : "Personal library unavailable. Unsynced edits remain on this device; retry explicitly.",
      ...(status === "account-changed" || status === "sign-in"
        ? { account: null, phrases: [], tags: [], pending: [] }
        : {}),
    });
  }
  async function load() {
    const version = ++generation;
    update({ busy: true });
    try {
      const account = await request("/api/me", accountSchema);
      const [phrases, tags, pending] = await Promise.all([
        request("/api/me/phrases", z.array(phraseSchema), account.id),
        request("/api/me/work-tags", z.array(tagSchema), account.id),
        store.list(account.id),
      ]);
      if (generation !== version) return;
      update({
        status: "ready",
        busy: false,
        message: "Personal library loaded.",
        account,
        phrases,
        tags,
        pending,
      });
    } catch (error) {
      if (generation === version) failure(error);
    }
  }
  async function sendPending(record: PendingPhrase, version: number) {
    await verifyOwner(record.ownerId);
    if (generation !== version || snapshot.account?.id !== record.ownerId)
      throw changed();
    const phrase = await request(
      "/api/me/phrases",
      phraseSchema,
      record.ownerId,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": record.id,
        },
        body: JSON.stringify(confirmedPhraseSchema.parse(record.input)),
      },
    );
    if (phrase.id !== record.id) throw new Error("Invalid phrase response.");
    await store.remove(record.id);
    if (generation !== version) return;
    update({
      status: "ready",
      busy: false,
      message: "Personal phrase saved.",
      phrases: [
        ...snapshot.phrases.filter((value) => value.id !== phrase.id),
        phrase,
      ],
      pending: snapshot.pending.filter((value) => value.id !== record.id),
    });
  }
  async function savePhrase(input: ConfirmedPhrase) {
    if (!snapshot.account || snapshot.busy) return false;
    const ownerId = snapshot.account.id;
    const version = generation;
    update({ busy: true });
    try {
      const parsed = confirmedPhraseSchema.parse(input);
      const record = snapshot.pending.find(
        (value) =>
          value.ownerId === ownerId &&
          JSON.stringify(value.input) === JSON.stringify(parsed),
      ) ?? { id: crypto.randomUUID(), ownerId, input: parsed };
      await store.put(record);
      if (generation !== version) return false;
      update({
        pending: [
          ...snapshot.pending.filter((value) => value.id !== record.id),
          record,
        ],
      });
      await sendPending(record, version);
      return true;
    } catch (error) {
      if (generation === version) failure(error);
      return false;
    }
  }
  async function retryPhrase(id: string) {
    if (!snapshot.account || snapshot.busy) return;
    const record = snapshot.pending.find(
      (value) => value.id === id && value.ownerId === snapshot.account?.id,
    );
    if (!record) return;
    const version = generation;
    update({ busy: true });
    try {
      await sendPending(record, version);
    } catch (error) {
      if (generation === version) failure(error);
    }
  }
  async function addTag(name: string) {
    if (!snapshot.account || snapshot.busy) return false;
    const ownerId = snapshot.account.id;
    const version = generation;
    update({ busy: true });
    try {
      const input = tagInputSchema.parse({ name, aliases: [] });
      await verifyOwner(ownerId);
      if (generation !== version) return false;
      const tags = await request(
        "/api/me/work-tags",
        z.array(tagSchema),
        ownerId,
      );
      let tag = tags.find((value) => value.name === input.name);
      if (!tag)
        tag = await request("/api/me/work-tags", tagSchema, ownerId, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
      if (generation !== version) return false;
      update({
        status: "ready",
        busy: false,
        message: "Personal work tag saved.",
        tags: [...tags.filter((value) => value.id !== tag.id), tag],
      });
      return true;
    } catch (error) {
      if (generation === version) failure(error);
      return false;
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    savePhrase,
    retryPhrase,
    addTag,
  };
}

import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { useAuthDatabaseFixtures } from "@/test/auth-database";
import { createSession } from "@/server/auth/sessions";
import { createWorkTag } from "@/server/db/repositories/work-tags";
import { findPhraseById, listPhrases } from "@/server/db/repositories/phrases";
import { GET, POST } from "@/app/api/me/phrases/route";
import { GET as identity } from "@/app/api/me/route";

const fixture = useAuthDatabaseFixtures();

it("exposes only authenticated account identity", async () => {
  const a = await account();
  expect((await identity(a.request("GET"))).status).toBe(200);
  const response = await identity(a.request("GET"));
  expect(await response.json()).toEqual({
    id: a.owner.id,
    displayName: a.owner.displayName,
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(
    (await identity(new Request("http://localhost:3000/api/me"))).status,
  ).toBe(401);
});
async function account() {
  const owner = await fixture.user();
  const session = await createSession(owner.id);
  const tag = await createWorkTag(owner.id, { name: "Work", aliases: [] });
  const input = {
    sourcePhrase: "第一架",
    language: "zh",
    glosses: [{ language: "en", text: "first unit" }],
    workTagIds: [tag.id],
  };
  return {
    owner,
    input,
    request(method: string, body?: unknown, headers = {}) {
      return new Request("http://localhost:3000/api/me/phrases", {
        method,
        headers: {
          Origin: "http://localhost:3000",
          Cookie: `moyu_session=${session.rawToken}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
  };
}

it("rejects a stale owner snapshot before reading or writing metadata", async () => {
  const a = await account();
  const headers = { "X-Moyu-Owner": randomUUID() };
  expect((await GET(a.request("GET", undefined, headers))).status).toBe(409);
  expect((await POST(a.request("POST", a.input, headers))).status).toBe(409);
  expect(await listPhrases(a.owner.id)).toEqual([]);
});

it("replays an identical phrase once and rejects changed or foreign-owner keys", async () => {
  const a = await account();
  const b = await account();
  const id = randomUUID();
  const headers = { "Idempotency-Key": id, "X-Moyu-Owner": a.owner.id };
  const first = await POST(a.request("POST", a.input, headers));
  expect(first.status).toBe(201);
  expect(await first.json()).toMatchObject({ id });
  const retry = await POST(a.request("POST", a.input, headers));
  expect(retry.status).toBe(201);
  expect(await retry.json()).toMatchObject({ id });
  expect(await listPhrases(a.owner.id)).toHaveLength(1);
  const changed = await POST(
    a.request("POST", { ...a.input, note: "changed" }, headers),
  );
  expect(changed.status).toBe(409);
  const foreign = await POST(
    b.request("POST", b.input, { "Idempotency-Key": id }),
  );
  expect(foreign.status).toBe(409);
  expect(await foreign.json()).toEqual(await changed.json());
  expect(await findPhraseById(b.owner.id, id)).toBeNull();
  expect(await findPhraseById(a.owner.id, id)).toMatchObject({ note: null });
});

it("rejects invalid owner and idempotency headers", async () => {
  const a = await account();
  for (const headers of [
    { "Idempotency-Key": "bad" },
    { "X-Moyu-Owner": "bad" },
  ]) {
    expect((await POST(a.request("POST", a.input, headers))).status).toBe(400);
  }
});

it("serializes simultaneous identical retries under the owner lock", async () => {
  const a = await account();
  const id = randomUUID();
  const responses = await Promise.all([
    POST(a.request("POST", a.input, { "Idempotency-Key": id })),
    POST(a.request("POST", a.input, { "Idempotency-Key": id })),
  ]);
  expect(responses.map((response) => response.status)).toEqual([201, 201]);
  expect(await listPhrases(a.owner.id)).toHaveLength(1);
});

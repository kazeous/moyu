import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { useAuthDatabaseFixtures } from "@/test/auth-database";
import { createSession } from "@/server/auth/sessions";
import { createPhrase } from "@/server/db/repositories/phrases";
import { createWorkTag } from "@/server/db/repositories/work-tags";
import { POST } from "@/app/api/me/work-tags/route";
import { DELETE, PUT } from "@/app/api/me/work-tags/[id]/route";
import { handleRequest, jsonResponse } from "./response";

const fixture = useAuthDatabaseFixtures();

async function requests() {
  const owner = await fixture.user();
  const session = await createSession(owner.id);
  return {
    owner,
    request(method: string, body?: unknown) {
      return new Request("http://localhost:3000/api/me/work-tags", {
        method,
        headers: {
          Origin: "http://localhost:3000",
          Cookie: `moyu_session=${session.rawToken}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
  };
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

it("returns sanitized 409 for deleting a final tag and still hides it from another owner", async () => {
  const { owner, request } = await requests();
  const tag = await createWorkTag(owner.id, {
    name: "Synthetic work",
    aliases: [],
  });
  await createPhrase(owner.id, {
    sourcePhrase: "第一架",
    language: "zh",
    glosses: [{ language: "en", text: "first unit" }],
    workTagIds: [tag.id],
  });
  const conflict = await DELETE(request("DELETE"), context(tag.id));
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({
    error: "A phrase must keep at least one work tag.",
  });
  const other = await requests();
  const hidden = await DELETE(other.request("DELETE"), context(tag.id));
  expect(hidden.status).toBe(404);
  expect(await hidden.json()).toEqual({ error: "Not found." });
});

it("returns sanitized 409 for duplicate creation and rename collision", async () => {
  const { owner, request } = await requests();
  await createWorkTag(owner.id, { name: "First", aliases: [] });
  const second = await createWorkTag(owner.id, { name: "Second", aliases: [] });
  const input = { name: " First ", aliases: [] };
  for (const response of [
    await POST(request("POST", input)),
    await PUT(request("PUT", input), context(second.id)),
  ]) {
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "A work tag with this name already exists.",
    });
  }
});

it("keeps unrelated PostgreSQL foreign-key failures sanitized as service outages", async () => {
  const response = await handleRequest(async () =>
    jsonResponse(
      await createWorkTag(randomUUID(), { name: "Synthetic", aliases: [] }),
    ),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Service unavailable. Try again later.",
  });
});

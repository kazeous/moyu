import { expect, test } from "@playwright/test";
import { jsonRequest, origin, phraseInput, register } from "./helpers";

test("two browser owners isolate actual phrase, tag and settings operations", async ({
  page: owner,
  browser,
}) => {
  await register(owner);
  const context = await browser.newContext();
  const other = await context.newPage();
  await register(other);
  const tag = await jsonRequest(owner, "/api/me/work-tags", "POST", {
    name: "Synthetic work",
    aliases: [],
  });
  expect(tag.status).toBe(201);
  const otherTag = await jsonRequest(other, "/api/me/work-tags", "POST", {
    name: "Other work",
    aliases: [],
  });
  expect(otherTag.status).toBe(201);
  const phrase = await jsonRequest(owner, "/api/me/phrases", "POST", {
    ...phraseInput,
    note: "clear on PUT",
    workTagIds: [tag.body.id],
  });
  expect(phrase.status).toBe(201);
  for (const [collection, record, replacement] of [
    ["phrases", phrase.body, { ...phraseInput, workTagIds: [tag.body.id] }],
    ["work-tags", tag.body, { name: "Updated work", aliases: [] }],
  ] as const) {
    const path = `/api/me/${collection}/${record.id}`;
    expect((await jsonRequest(owner, path)).status).toBe(200);
    expect(
      (await jsonRequest(other, `/api/me/${collection}`)).body.map(
        (item: { id: string }) => item.id,
      ),
    ).not.toContain(record.id);
    for (const method of ["GET", "PUT", "DELETE"])
      expect(
        (
          await jsonRequest(
            other,
            path,
            method,
            method === "PUT"
              ? collection === "phrases"
                ? { ...phraseInput, workTagIds: [otherTag.body.id] }
                : replacement
              : undefined,
          )
        ).status,
      ).toBe(404);
    expect((await jsonRequest(owner, path)).status).toBe(200);
    const updated = await jsonRequest(owner, path, "PUT", replacement);
    expect(updated.status).toBe(200);
    if (collection === "phrases") expect(updated.body.note).toBeNull();
  }
  expect(
    (
      await jsonRequest(other, "/api/me/phrases", "POST", {
        ...phraseInput,
        workTagIds: [tag.body.id],
      })
    ).status,
  ).toBe(400);
  expect(
    (await jsonRequest(owner, "/api/me/settings", "PATCH", { theme: "dark" }))
      .body.theme,
  ).toBe("dark");
  expect(
    (await jsonRequest(other, "/api/me/settings", "PATCH", { theme: "light" }))
      .body.theme,
  ).toBe("light");
  expect(
    (
      await jsonRequest(other, "/api/me/settings", "PATCH", {
        theme: "light",
        ownerId: phrase.body.ownerId ?? "guessed-owner",
      })
    ).status,
  ).toBe(400);
  expect((await jsonRequest(owner, "/api/me/settings")).body.theme).toBe(
    "dark",
  );
  expect(
    (await jsonRequest(owner, `/api/me/phrases/${phrase.body.id}`, "DELETE"))
      .status,
  ).toBe(204);
  expect(
    (await jsonRequest(owner, `/api/me/work-tags/${tag.body.id}`, "DELETE"))
      .status,
  ).toBe(204);
  await context.close();
});

test("authenticated valid baselines reject forbidden and nested review fields", async ({
  page,
  request,
}) => {
  expect(
    (
      await request.post("/api/me/phrases", {
        headers: { Origin: origin },
        data: phraseInput,
      })
    ).status(),
  ).toBe(401);
  await register(page);
  const ownedTag = await jsonRequest(page, "/api/me/work-tags", "POST", {
    name: "Privacy test work",
    aliases: [],
  });
  expect(ownedTag.status).toBe(201);
  const validInput = { ...phraseInput, workTagIds: [ownedTag.body.id] };
  const baseline = await jsonRequest(
    page,
    "/api/me/phrases",
    "POST",
    validInput,
  );
  expect(baseline.status).toBe(201);
  expect(
    (
      await jsonRequest(page, "/api/me/phrases", "POST", {
        ...validInput,
        workTagIds: [],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await jsonRequest(page, `/api/me/phrases/${baseline.body.id}`, "PUT", {
        ...validInput,
        workTagIds: [],
      })
    ).status,
  ).toBe(400);
  for (const key of [
    "dialogue",
    "translation",
    "image",
    "ocrText",
    "tokens",
    "lookupResults",
    "selectionHistory",
    "ownerId",
  ]) {
    const response = await jsonRequest(page, "/api/me/phrases", "POST", {
      ...validInput,
      [key]: "synthetic forbidden value",
    });
    expect(response).toEqual({
      status: 400,
      body: { error: "Invalid request." },
    });
  }
  expect(
    (
      await jsonRequest(page, "/api/me/phrases", "POST", {
        ...validInput,
        glosses: [{ ...phraseInput.glosses[0], ocrText: "forbidden" }],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await jsonRequest(page, "/api/me/work-tags", "POST", {
        name: "Valid",
        aliases: [],
        dialogue: "forbidden",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await jsonRequest(page, "/api/me/settings", "PATCH", {
        theme: "dark",
        selectionHistory: [],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await page.request.post("/api/me/work-tags", {
        headers: { Origin: "https://evil.example.test" },
        data: { name: "Valid", aliases: [] },
      })
    ).status(),
  ).toBe(403);
  expect((await jsonRequest(page, "/api/me/phrases/not-a-uuid")).status).toBe(
    404,
  );
});

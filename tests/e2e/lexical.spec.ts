import { expect, test, type Page } from "@playwright/test";
import { register } from "./helpers";

test.use({ launchOptions: { args: ["--js-flags=--max-old-space-size=384"] } });

async function importText(
  page: Page,
  source: string,
  language: "Japanese" | "Chinese" = "Japanese",
) {
  await page.goto("/workspace");
  await page.getByLabel("Paste dialogue").fill(source);
  await page.getByRole("button", { name: "Source only", exact: true }).click();
  await page
    .getByRole("group", { name: "Language for pasted source", exact: true })
    .getByRole("button", { name: language, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review and correct pairs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start local review", exact: true })
    .click();
}

test("installs real local dictionaries, inspects evidence, restores selection and never uploads dialogue", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const source = "猫と学校。\n私的な謎語🛸";
  const leaks: string[] = [];
  const api: string[] = [];
  page.on("request", (request) => {
    const content = `${decodeURIComponent(request.url())}\n${request.postData() ?? ""}`;
    if (content.includes("猫と学校") || content.includes("私的な謎語"))
      leaks.push(content);
    if (new URL(request.url()).pathname.startsWith("/api/"))
      api.push(request.url());
  });
  await importText(page, source);
  await page
    .getByRole("button", { name: "Install dictionaries", exact: true })
    .click();
  const cat = page.getByRole("button", {
    name: "Inspect token: 猫",
    exact: true,
  });
  await expect(cat).toBeVisible({ timeout: 120_000 });
  await cat.click();
  const evidence = page.locator(".workspace__evidence-panel");
  await expect(
    evidence.getByText("ねこ", { exact: true }).first(),
  ).toBeVisible();
  const attribution = evidence
    .locator("summary")
    .filter({ hasText: "JMdict Japanese" })
    .first();
  await expect(attribution).toBeVisible();
  await attribution.click();
  await expect(
    evidence.getByText("CC BY-SA 4.0", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(cat).toBeVisible({ timeout: 120_000 });
  await expect(cat).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Evidence", exact: true });
  await expect(
    drawer.getByText("Surface form", { exact: true }),
  ).toBeInViewport();
  expect(leaks).toEqual([]);
  expect(api).toEqual([]);
});

test("dictionary download failures preserve the source and offer retry", async ({
  page,
}) => {
  await page.route("**/lexical/*.json.gz", (route) => route.abort());
  await importText(page, "学生", "Chinese");
  await page
    .getByRole("button", { name: "Install dictionaries", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry dictionaries", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("article").first()).toContainText("学生");
});

test("recovers a lost worker index and keeps offline line changes local", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const workers: Worker[] = [];
    Object.assign(window, { phase4Workers: workers });
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        workers.push(this);
      }
    };
  });
  await importText(page, "我\n學生", "Chinese");
  await page
    .getByRole("button", { name: "Install dictionaries", exact: true })
    .click();
  const first = page.getByRole("button", {
    name: "Inspect token: 我",
    exact: true,
  });
  await expect(first).toBeVisible({ timeout: 90_000 });
  await first.click();
  await page.evaluate(() => {
    const workers = (window as typeof window & { phase4Workers: Worker[] })
      .phase4Workers;
    workers.at(-1)!.dispatchEvent(new Event("error", { cancelable: true }));
  });
  await page.getByRole("button", { name: "2 學生", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry analysis", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Unknown", { exact: true })).toHaveCount(0);
  await page.route("**/lexical/*.json.gz", (route) => route.abort());
  await page
    .getByRole("button", { name: "Retry analysis", exact: true })
    .click();
  const second = page.getByRole("button", {
    name: "Inspect token: 學生",
    exact: true,
  });
  await expect(second).toBeVisible({ timeout: 90_000 });
  await second.click();
  const evidence = page.locator(".workspace__evidence-panel");
  await expect(
    evidence.getByText("xue2 sheng5", { exact: true }).first(),
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "1 我", exact: true }).click();
  await page.getByRole("button", { name: "2 學生", exact: true }).click();
  await page.getByRole("button", { name: "1 我", exact: true }).click();
  await expect(first).toBeVisible();
  await expect(second).toHaveCount(0);
  await first.click();
  await expect(
    evidence.getByText("Tôi, ta, tao.", { exact: true }).first(),
  ).toBeVisible();
  await expect(evidence.getByText("xue2 sheng5", { exact: true })).toHaveCount(
    0,
  );
});

test("Chinese evidence retains unknown spans and works in the narrow drawer", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await importText(page, "學生我\uE000", "Chinese");
  await page
    .getByRole("button", { name: "Install dictionaries", exact: true })
    .click();
  const student = page.getByRole("button", {
    name: "Inspect token: 學生",
    exact: true,
  });
  await expect(student).toBeVisible({ timeout: 90_000 });
  await student.click();
  await expect(
    page
      .locator(".workspace__evidence-panel")
      .getByText("xue2 sheng5", { exact: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect token: 我", exact: true })
    .click();
  await expect(
    page
      .locator(".workspace__evidence-panel")
      .getByText("Tôi, ta, tao.", { exact: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect token: \uE000", exact: true })
    .click();
  await expect(
    page
      .locator(".workspace__evidence-panel")
      .getByText("Unknown", { exact: true }),
  ).toBeVisible();
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.getByRole("button", { name: "Evidence", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Evidence", exact: true });
    await expect(drawer.getByText("Unknown", { exact: true })).toBeVisible();
    await expect(drawer).toBeInViewport({ ratio: 0.5 });
    await page.screenshot({
      path: `test-results/lexical-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
  }
});

test("saves only an explicitly confirmed phrase and retries a lost response without duplicates", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await register(page);
  const sent: { key: string | undefined; body: Record<string, unknown> }[] = [];
  let loseResponse = true;
  await page.route("**/api/me/phrases", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    sent.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postDataJSON(),
    });
    if (loseResponse) {
      loseResponse = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort();
    } else await route.continue();
  });
  await importText(page, "猫と学校\n猫と学校");
  await page
    .getByRole("button", { name: "Install dictionaries", exact: true })
    .click();
  const cat = page.getByRole("button", {
    name: "Inspect token: 猫",
    exact: true,
  });
  await expect(cat).toBeVisible({ timeout: 90_000 });
  await cat.click();
  await page
    .getByRole("button", { name: "Inspect token: 学校", exact: true })
    .click({ modifiers: ["Shift"] });
  await page
    .getByRole("button", { name: "Load personal library", exact: true })
    .click();
  await expect(page.getByLabel("Selected phrase · Japanese")).toHaveValue(
    "猫と学校",
  );
  await cat.click();
  await page.getByLabel("New personal work tag").fill("Review glossary");
  await page
    .getByRole("button", { name: "Add personal tag", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Review glossary", exact: true })
    .check();
  await page
    .getByLabel("English gloss", { exact: true })
    .fill("pet in this work");
  await page
    .getByLabel("Vietnamese gloss", { exact: true })
    .fill("mèo trong tác phẩm");
  await page
    .getByRole("button", { name: "Save personal phrase", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Unsynced personal phrases",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Load personal library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry personal phrase", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Inspect personal phrase: 猫",
      exact: true,
    }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByRole("heading", {
      name: "Unsynced personal phrases",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(sent).toHaveLength(2);
  expect(sent[0]).toEqual(sent[1]);
  expect(Object.keys(sent[0].body).sort()).toEqual([
    "glosses",
    "language",
    "note",
    "sourcePhrase",
    "workTagIds",
  ]);
  expect(sent[0].body.sourcePhrase).toBe("猫");
  const phrases = await (await page.request.get("/api/me/phrases")).json();
  expect(phrases).toHaveLength(1);
  await page.screenshot({
    path: "test-results/lexical-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Clear session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear local session", exact: true })
    .click();
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  expect(await (await page.request.get("/api/me/phrases")).json()).toHaveLength(
    1,
  );
});

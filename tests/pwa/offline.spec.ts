import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

async function disconnect(
  page: Page,
  request: APIRequestContext,
  browserName: string,
) {
  await request.post("http://127.0.0.1:3105/offline");
  // WebKit's headless offline emulation can reject navigations before the
  // service worker. Its proxy returns 503 for every uncached asset instead.
  if (browserName !== "webkit") await page.context().setOffline(true);
}

test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3105/online");
});
test.afterEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3105/online");
});

test("exposes install metadata and handles an available browser install prompt", async ({
  page,
  request,
}) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({
    start_url: "/workspace",
    scope: "/",
    display: "standalone",
  });
  await page.goto("/workspace");
  await page
    .getByRole("button", { name: "Install / offline", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Use moyu offline" }),
  ).toBeVisible();
  for (const size of [192, 512]) {
    expect(
      await page.evaluate(async (size) => {
        const response = await fetch(`/icons/icon-${size}.png`);
        const bitmap = await createImageBitmap(await response.blob());
        const dimensions = [bitmap.width, bitmap.height];
        bitmap.close();
        return dimensions;
      }, size),
    ).toEqual([size, size]);
  }
  // Exercise the app's event-driven install control; native OS installation is
  // deliberately outside a headless browser test.
  await page.evaluate(() => {
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt: async () => {
          document.documentElement.dataset.installPrompted = "true";
        },
        userChoice: Promise.resolve({ outcome: "accepted" }),
      },
    );
    window.dispatchEvent(event);
  });
  await page.getByRole("button", { name: "Install moyu", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-install-prompted",
    "true",
  );
});

test("installed public shell restores and clears private review offline without caching account responses", async ({
  page,
  context,
  request,
  browserName,
}) => {
  await page.goto("/workspace");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page
    .getByLabel("Paste dialogue")
    .fill("この内容は端末だけ\nLocal reference");
  await page.getByRole("button", { name: "Review and correct pairs" }).click();
  await page.getByRole("button", { name: "Start local review" }).click();
  await expect(page.getByText("Saved in this browser.")).toBeVisible();
  await page.evaluate(() => fetch("/api/me/phrases"));
  const keys = await page.evaluate(async () => {
    const cachesByName = await Promise.all(
      (await caches.keys()).map((key) => caches.open(key)),
    );
    return (await Promise.all(cachesByName.map((cache) => cache.keys())))
      .flat()
      .map((request) => request.url);
  });
  expect(keys.length).toBeGreaterThan(3);
  expect(
    keys.some((key) => /\/api\/|\/account|\/sign-in|この内容/u.test(key)),
  ).toBe(false);
  const mutations: string[] = [];
  context.on("request", (request) => {
    if (request.method() !== "GET") mutations.push(request.url());
  });
  await disconnect(page, request, browserName);
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Continuous dialogue review" })
      .getByText("この内容は端末だけ", { exact: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^(Offline|Install \/ offline)$/u })
    .click();
  await expect(page.getByText(/Workspace ready offline/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Clear session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear local session", exact: true })
    .click();
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  expect(mutations).toEqual([]);
});

test("installed dictionary evidence survives offline worker restart", async ({
  page,
  request,
  browserName,
}) => {
  await page.goto("/workspace");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.getByLabel("Paste dialogue").fill("猫と学校。");
  await page.getByRole("button", { name: "Review and correct pairs" }).click();
  await page.getByRole("button", { name: "Start local review" }).click();
  await page
    .getByRole("button", { name: "Install dictionaries", exact: true })
    .click();
  const cat = page.getByRole("button", {
    name: "Inspect token: 猫",
    exact: true,
  });
  await expect(cat).toBeVisible({ timeout: 60_000 });
  await disconnect(page, request, browserName);
  await page.reload();
  await expect(cat).toBeVisible({ timeout: 60_000 });
  await cat.click();
  await expect(
    page
      .locator(".workspace__evidence-panel")
      .getByText("ねこ", { exact: true })
      .first(),
  ).toBeVisible();
});

test("image correction and cached OCR survive offline reload", async ({
  page,
  request,
  browserName,
}) => {
  await page.goto("/workspace");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.getByRole("button", { name: "Import image", exact: true }).click();
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 200;
    const draw = canvas.getContext("2d")!;
    draw.fillStyle = "white";
    draw.fillRect(0, 0, 800, 200);
    draw.fillStyle = "black";
    draw.font = "64px sans-serif";
    draw.fillText("日本語の文章です", 30, 110);
    return Array.from(
      Uint8Array.from(atob(canvas.toDataURL().split(",")[1]!), (character) =>
        character.charCodeAt(0),
      ),
    );
  });
  await page.getByLabel("Image file").setInputFiles({
    name: "local.png",
    mimeType: "image/png",
    buffer: Buffer.from(bytes),
  });
  await page
    .getByRole("button", { name: "Recognize image", exact: true })
    .click();
  await expect(page.getByText(/Recognition complete/)).toBeVisible({
    timeout: 60_000,
  });
  await page.getByLabel("Corrected image text").fill("私の画像の修正");
  await expect(
    page.getByText("Image draft saved in this browser."),
  ).toBeVisible();
  await disconnect(page, request, browserName);
  await page.reload();
  await page.getByRole("button", { name: "Resume image draft" }).click();
  await expect(page.getByLabel("Corrected image text")).toHaveValue(
    "私の画像の修正",
  );
  await page
    .getByRole("button", { name: "Retry recognition", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel recognition" }),
  ).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/OCR is unavailable/)).toHaveCount(0);
  await expect(page.getByLabel("Corrected image text")).toHaveValue(
    "私の画像の修正",
  );
});

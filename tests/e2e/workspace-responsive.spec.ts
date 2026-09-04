import { expect, test, type Page } from "@playwright/test";

async function importFixture(page: Page) {
  await page.goto("/workspace");
  await page
    .getByLabel("Paste dialogue")
    .fill("第一架\nThe first unit\n第二架\nThe second unit");
  await page
    .getByRole("button", {
      name: "Alternating source and reference",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Review and correct pairs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start local review", exact: true })
    .click();
}

async function importLongFixture(page: Page) {
  await page.goto("/workspace");
  await page
    .getByLabel("Paste dialogue")
    .fill(
      Array.from({ length: 60 }, (_, index) => `会話 ${index + 1}`).join("\n"),
    );
  await page.getByRole("button", { name: "Source only", exact: true }).click();
  await page
    .getByRole("button", { name: "Review and correct pairs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start local review", exact: true })
    .click();
}

for (const width of [320, 375, 414, 768]) {
  test(`${width}px keeps dialogue readable with mobile navigator and evidence drawer`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await importFixture(page);

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

    const reviewBounds = await page
      .getByRole("region", { name: "Continuous dialogue review" })
      .boundingBox();
    expect(reviewBounds?.x).toBeLessThanOrEqual(1);
    expect(reviewBounds?.width).toBeGreaterThanOrEqual(width - 2);

    await expect(
      page.getByRole("navigation", { name: "Dialogue position" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Account" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Evidence", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Evidence", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Evidence" })).toBeVisible();
    await expect(page.getByText("Not available yet").last()).toBeVisible();
  });
}

test("320px import controls remain visible and touch sized", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/workspace");
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  await expect(page.getByRole("link", { name: "Account" })).toBeVisible();

  const controls = page.locator(
    '[data-slot="toggle-group-item"], [data-slot="button"]',
  );
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const bounds = await controls.nth(index).boundingBox();
    if (!bounds) continue;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  }
});

test("editing a paste preserves an explicitly selected import mode", async ({
  page,
}) => {
  await page.goto("/workspace");
  const paste = page.getByLabel("Paste dialogue");
  await paste.fill("一行目\nFirst line\n二行目\nSecond line");
  await page.getByRole("button", { name: "Source only", exact: true }).click();
  await paste.fill("一行目\nFirst line\n二行目\nSecond line\n三行目");

  await expect(
    page.getByRole("button", { name: "Source only", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("mobile navigator follows central scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await importLongFixture(page);

  await page
    .locator("article")
    .nth(40)
    .evaluate((element) => {
      const surface = element.closest<HTMLElement>(
        ".workspace__review-surface",
      );
      if (!surface) throw new Error("Review surface is missing");
      surface.scrollTop += element.getBoundingClientRect().top - 108;
    });

  const activeItem = page.locator(
    '.workspace__mobile-navigator button[aria-current="true"]',
  );
  await expect(activeItem).toContainText(/(?:3[5-9]|4[0-5])会話/);
  await expect(activeItem).toBeInViewport();
});

test("320px overlays and recovery actions remain touch sized", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await importFixture(page);

  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  const sheetClose = page.getByRole("button", { name: "Close", exact: true });
  expect((await sheetClose.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect((await sheetClose.boundingBox())?.width).toBeGreaterThanOrEqual(44);
  await sheetClose.click();

  await page
    .getByRole("button", { name: "Clear session", exact: true })
    .click();
  for (const name of ["Keep session", "Clear local session"]) {
    const action = page.getByRole("button", { name, exact: true });
    await expect(action).toBeVisible();
    await expect
      .poll(async () => (await action.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
  }
});

test("320px storage recovery action remains touch sized", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/workspace");

  const retry = page.getByRole("button", {
    name: "Try local storage again",
    exact: true,
  });
  await expect(retry).toBeVisible();
  expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(44);
});

test("desktop evidence width is draggable and restored locally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await importFixture(page);

  const evidencePanel = page.locator(".workspace__evidence-panel");
  const evidenceHandle = page.getByRole("separator").nth(1);
  const initialWidth = (await evidencePanel.boundingBox())?.width ?? 0;
  const handleBox = await evidenceHandle.boundingBox();
  if (!handleBox) throw new Error("Evidence resize handle is not visible");

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 96, handleBox.y + handleBox.height / 2);
  await page.mouse.up();

  await expect
    .poll(async () => (await evidencePanel.boundingBox())?.width ?? 0)
    .toBeGreaterThan(initialWidth + 48);
  const resizedWidth = (await evidencePanel.boundingBox())?.width ?? 0;

  await page.reload();
  await expect
    .poll(async () => (await evidencePanel.boundingBox())?.width ?? 0)
    .toBeGreaterThan(initialWidth + 48);
  const restoredWidth = (await evidencePanel.boundingBox())?.width ?? 0;
  expect(Math.abs(restoredWidth - resizedWidth)).toBeLessThanOrEqual(4);
});

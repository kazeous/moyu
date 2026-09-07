import { expect, test, type Page } from "@playwright/test";

async function imageBytes(page: Page, source = "日本語の文章です") {
  return Buffer.from(
    await page.evaluate((source) => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 220;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "white";
      context.fillRect(0, 0, 800, 220);
      context.fillStyle = "black";
      context.font = "64px sans-serif";
      context.fillText(source, 35, 115);
      return Array.from(
        Uint8Array.from(
          atob(canvas.toDataURL("image/png").split(",")[1]!),
          (c) => c.charCodeAt(0),
        ),
      );
    }, source),
  );
}

test("image OCR stays local, requires correction, resumes and clears", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const requests: { url: string; body: string | null }[] = [];
  page.on("request", (request) =>
    requests.push({ url: request.url(), body: request.postData() }),
  );
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Import image" }).click();
  const bytes = await imageBytes(page);
  await page.getByLabel("Image file").setInputFiles({
    name: "private-image.png",
    mimeType: "image/png",
    buffer: bytes,
  });
  await page
    .getByRole("button", { name: "Recognize image", exact: true })
    .click();
  await expect(page.getByText(/Recognition complete/)).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByLabel("Corrected image text")).not.toHaveValue("");
  await expect(page.locator(".workspace__review-entry")).toHaveCount(0);
  await page
    .getByLabel("Corrected image text")
    .fill("  非公開画像の修正です  ");
  await expect(
    page.getByText("Image draft saved in this browser."),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume image draft" }).click();
  await expect(page.getByLabel("Corrected image text")).toHaveValue(
    "  非公開画像の修正です  ",
  );
  await expect(page.getByAltText("Original local image")).toBeVisible();
  await page.getByRole("button", { name: "Preview image import" }).click();
  await page
    .getByRole("button", { name: "Start local review", exact: true })
    .click();
  await expect(
    page.getByText("非公開画像の修正です", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Clear session", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Clear local session", exact: true })
    .click();
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume image draft" }),
  ).toHaveCount(0);
  expect(
    requests.filter(
      ({ url, body }) =>
        body !== null ||
        /private-image|非公開画像|日本語の文章|data:image|\/api\//u.test(
          decodeURIComponent(url),
        ),
    ),
  ).toEqual([]);
  expect(
    requests.every(
      ({ url }) => new URL(url).origin === "http://127.0.0.1:3000",
    ),
  ).toBe(true);
});

for (const language of ["Simplified Chinese", "Traditional Chinese"]) {
  test(`recognizes a ${language} image locally`, async ({ page }) => {
    await page.goto("/workspace");
    await page
      .getByRole("button", { name: "Import image", exact: true })
      .click();
    await page
      .getByRole("group", { name: "Image language", exact: true })
      .getByRole("button", { name: language, exact: true })
      .click();
    await page.getByLabel("Image file").setInputFiles({
      name: "local.png",
      mimeType: "image/png",
      buffer: await imageBytes(
        page,
        language === "Simplified Chinese" ? "这是中文的句子" : "這是中文的句子",
      ),
    });
    await page
      .getByRole("button", { name: "Recognize image", exact: true })
      .click();
    await expect(page.getByText(/Recognition complete/)).toBeVisible();
    await expect(page.getByLabel("Corrected image text")).not.toHaveValue("");
  });
}

test("failed OCR retains the image and permits manual correction", async ({
  page,
}) => {
  await page.route("**/ocr/v1/lang/*.gz", (route) => route.abort());
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Import image" }).click();
  await page.getByLabel("Image file").setInputFiles({
    name: "private.png",
    mimeType: "image/png",
    buffer: await imageBytes(page),
  });
  await page
    .getByRole("button", { name: "Recognize image", exact: true })
    .click();
  await expect(page.getByText(/OCR is unavailable/)).toBeVisible();
  await expect(page.getByAltText("Original local image")).toBeVisible();
  await page.getByLabel("Corrected image text").fill("手動修正");
  await page.getByRole("button", { name: "Preview image import" }).click();
  await page
    .getByRole("button", { name: "Start local review", exact: true })
    .click();
  await expect(
    page.getByText("手動修正", { exact: true }).first(),
  ).toBeVisible();
});

test("regular image paste and cancellation preserve a resumable draft", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Import image", exact: true }).click();
  const bytes = await imageBytes(page);
  await page.getByRole("dialog").evaluate((element, data) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([new Uint8Array(data)], "private-paste.png", {
        type: "image/png",
      }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true }),
    );
  }, Array.from(bytes));
  await expect(page.getByAltText("Original local image")).toBeVisible();
  await page
    .getByRole("button", { name: "Recognize image", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel recognition" })
    .click({ timeout: 2000 });
  await expect(
    page.getByText("Recognition cancelled", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Corrected image text").fill("取消後の手動修正");
  await expect(
    page.getByText("Image draft saved in this browser."),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume image draft" }).click();
  await expect(page.getByLabel("Corrected image text")).toHaveValue(
    "取消後の手動修正",
  );
});

test("replacing an image preserves the chosen pairing after reload", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Import image", exact: true }).click();
  const file = {
    name: "local.png",
    mimeType: "image/png",
    buffer: await imageBytes(page),
  };
  await page.getByLabel("Image file").setInputFiles(file);
  await page
    .getByRole("button", {
      name: "Alternating source and reference",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Vietnamese", exact: true }).click();
  await page.getByLabel("Image file").setInputFiles(file);
  await expect(
    page.getByText("Image draft saved in this browser."),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume image draft" }).click();
  await expect(
    page.getByRole("button", {
      name: "Alternating source and reference",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Vietnamese", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

for (const width of [320, 375, 768, 1280]) {
  test(`image correction remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/workspace");
    await page
      .getByRole("button", { name: "Import image", exact: true })
      .click();
    await page.getByLabel("Image file").setInputFiles({
      name: "local.png",
      mimeType: "image/png",
      buffer: await imageBytes(page),
    });
    await page
      .getByLabel("Corrected image text")
      .fill("日本語の画像\nImage reference");
    await expect(page.getByRole("dialog")).toBeVisible();
    const fits = await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
    expect(fits).toBe(true);
    const bounds = await page.getByRole("dialog").boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
    await page.screenshot({
      path: `test-results/ocr-${width}.png`,
      animations: "disabled",
    });
  });
}

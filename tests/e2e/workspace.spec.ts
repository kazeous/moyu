import { expect, test } from "@playwright/test";

async function storedActiveLineId(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      new Promise<string | undefined>((resolve, reject) => {
        const openRequest = indexedDB.open("moyu-local-review", 1);
        openRequest.addEventListener("error", () => reject(openRequest.error), {
          once: true,
        });
        openRequest.addEventListener(
          "success",
          () => {
            const database = openRequest.result;
            const request = database
              .transaction("sessions", "readonly")
              .objectStore("sessions")
              .get("active");
            request.addEventListener(
              "error",
              () => {
                database.close();
                reject(request.error);
              },
              { once: true },
            );
            request.addEventListener(
              "success",
              () => {
                const value = request.result as
                  { activeLineId?: string } | undefined;
                database.close();
                resolve(value?.activeLineId);
              },
              { once: true },
            );
          },
          { once: true },
        );
      }),
  );
}

async function importDialogue(
  page: import("@playwright/test").Page,
  dialogue: string,
  mode: "source-only" | "alternating" = "alternating",
) {
  await page.goto("/workspace");
  await page.getByLabel("Paste dialogue").fill(dialogue);
  await page
    .getByRole("button", {
      name:
        mode === "alternating"
          ? "Alternating source and reference"
          : "Source only",
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

test("dialogue import stays local, survives reload, and clears only on confirmation", async ({
  page,
}) => {
  const dialogue = "これは外部へ送信されません。";
  const requestsContainingDialogue: string[] = [];
  const workspaceApiRequests: string[] = [];

  page.on("request", (request) => {
    const requestContents = `${decodeURIComponent(request.url())}\n${request.postData() ?? ""}`;

    if (requestContents.includes(dialogue)) {
      requestsContainingDialogue.push(requestContents);
    }

    if (new URL(request.url()).pathname.startsWith("/api/")) {
      workspaceApiRequests.push(request.url());
    }
  });

  await page.goto("/workspace");
  workspaceApiRequests.length = 0;
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  await page
    .getByLabel("Paste dialogue")
    .fill(
      `${dialogue}\nThis is not sent outside the browser.\n二行目です。\nSecond line.`,
    );
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
    .getByLabel("Reference for entry 1")
    .fill("Corrected local reference.");
  await page
    .getByRole("button", { name: "Start local review", exact: true })
    .click();

  expect(requestsContainingDialogue).toEqual([]);
  expect(workspaceApiRequests).toEqual([]);

  await expect(
    page.getByRole("heading", {
      name: "2 local dialogue entries",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("article").first()).toContainText(dialogue);
  await expect(page.locator("article").first()).toContainText(
    "Corrected local reference.",
  );
  await page.getByRole("button", { name: /2 二行目です。/ }).click();
  await expect(page.locator("article").nth(1)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect.poll(() => storedActiveLineId(page)).toBe("line-2");

  await page.reload();
  await expect(page.locator("article").first()).toContainText(dialogue);
  await expect(page.locator("article").nth(1)).toHaveAttribute(
    "aria-current",
    "true",
  );

  await page
    .getByRole("button", { name: "Clear session", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Clear this local review session?",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear local session", exact: true })
    .click();
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  await expect(page.getByText(dialogue, { exact: true })).toHaveCount(0);
  expect(requestsContainingDialogue).toEqual([]);
  expect(workspaceApiRequests).toEqual([]);
});

test("arrow keys coordinate one expanded active line and unavailable evidence", async ({
  page,
}) => {
  await importDialogue(page, "第一架\nThe first unit\n第二架\nThe second unit");

  const review = page.getByRole("region", {
    name: "Continuous dialogue review",
  });
  await review.focus();
  await page.keyboard.press("ArrowDown");

  const entries = page.locator("article");
  await expect(entries.nth(0)).not.toHaveAttribute("aria-current", "true");
  await expect(entries.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByText("Local token evidence is unavailable"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("status").filter({ hasText: "Not available yet" }).first(),
  ).toBeVisible();

  await page.getByRole("link", { name: "Account" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(entries.nth(1)).toHaveAttribute("aria-current", "true");

  const rawSpan = page.getByRole("button", {
    name: /Inspect unprocessed source span/,
  });
  await rawSpan.focus();
  await page.keyboard.press("ArrowUp");
  await expect(entries.nth(1)).toHaveAttribute("aria-current", "true");
});

test("only the active line exposes one truthful unprocessed source span", async ({
  page,
}) => {
  await importDialogue(page, "第一架\nThe first unit\n第二架\nThe second unit");

  const rawSpan = page.getByRole("button", {
    name: /Inspect unprocessed source span/,
  });
  await expect(rawSpan).toHaveCount(1);
  await expect(rawSpan).toContainText("第一架");
  await expect(rawSpan).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "2 第二架", exact: true }).click();
  await expect(rawSpan).toHaveCount(1);
  await expect(rawSpan).toContainText("第二架");
  await expect(page.getByText("Surface form")).toBeVisible();
  await expect(page.getByText("Lexical assets not installed")).toBeVisible();
});

test("central scrolling keeps the active navigator item visible", async ({
  page,
}) => {
  const lines = Array.from({ length: 60 }, (_, index) => `会話 ${index + 1}`);
  await importDialogue(page, lines.join("\n"), "source-only");

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
  const activeNavigatorItem = page.locator(
    '.workspace__navigator-item[aria-current="true"]',
  );
  await expect(activeNavigatorItem).toContainText(/(?:3[5-9]|4[0-5])会話/);
  await expect(activeNavigatorItem).toBeInViewport();
});

test("user scroll intent releases an unfinished programmatic scroll", async ({
  page,
}) => {
  const lines = Array.from({ length: 60 }, (_, index) => `会話 ${index + 1}`);
  await importDialogue(page, lines.join("\n"), "source-only");

  await page.evaluate(() => {
    HTMLElement.prototype.scrollIntoView = () => undefined;
  });
  await page.getByRole("button", { name: "60 会話 60", exact: true }).click();

  const surface = page.getByRole("region", {
    name: "Continuous dialogue review",
  });
  await surface.dispatchEvent("wheel", { deltaY: -100 });
  await page
    .locator("article")
    .nth(20)
    .evaluate((element) => {
      const reviewSurface = element.closest<HTMLElement>(
        ".workspace__review-surface",
      );
      if (!reviewSurface) throw new Error("Review surface is missing");
      reviewSurface.scrollTop += element.getBoundingClientRect().top - 108;
    });

  await expect(
    page.getByRole("button", { name: "21 会話 21", exact: true }).first(),
  ).toHaveAttribute("aria-current", "true");
});

test("upward smooth scrolling keeps the requested line active through scroll end", async ({
  page,
}) => {
  const lines = Array.from({ length: 60 }, (_, index) => `会話 ${index + 1}`);
  await importDialogue(page, lines.join("\n"), "source-only");

  await page.getByRole("button", { name: "60 会話 60", exact: true }).click();
  await expect(page.locator("article").nth(59)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("button", { name: "10 会話 10", exact: true }).click();
  await expect(page.locator("article").nth(9)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.waitForTimeout(1_200);
  await expect(page.locator("article").nth(9)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.locator("article").nth(9)).toBeInViewport();
});

test("reduced motion uses immediate programmatic scrolling", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await importDialogue(page, "一行目\n二行目", "source-only");
  await page.evaluate(() => {
    const calls: Array<ScrollIntoViewOptions | boolean | undefined> = [];
    Object.defineProperty(window, "__scrollIntoViewCalls", { value: calls });
    HTMLElement.prototype.scrollIntoView = (options) => calls.push(options);
  });

  await page.getByRole("button", { name: "2 二行目", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (
        window as typeof window & {
          __scrollIntoViewCalls: Array<ScrollIntoViewOptions | boolean>;
        }
      ).__scrollIntoViewCalls.some(
        (options) => typeof options === "object" && options.behavior === "auto",
      ),
    ),
  ).toBe(true);
});

test("offers a safe way to clear an unreadable local session", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("moyu-local-review", 1);
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
        request.addEventListener(
          "upgradeneeded",
          () => request.result.createObjectStore("sessions"),
          { once: true },
        );
        request.addEventListener(
          "success",
          () => {
            const database = request.result;
            const transaction = database.transaction("sessions", "readwrite");
            transaction
              .objectStore("sessions")
              .put({ version: 1, dialogue: "must remain local" }, "active");
            transaction.addEventListener(
              "complete",
              () => {
                database.close();
                resolve();
              },
              { once: true },
            );
            transaction.addEventListener(
              "error",
              () => reject(transaction.error),
              {
                once: true,
              },
            );
          },
          { once: true },
        );
      }),
  );

  await page.reload();
  await expect(
    page.getByText("The saved local review session cannot be read safely."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear unreadable local data", exact: true })
    .click();
  await expect(
    page.getByText("Unreadable local data was cleared.", { exact: true }),
  ).toBeVisible();
});

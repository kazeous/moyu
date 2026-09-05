import { expect, test, type Page } from "@playwright/test";

import {
  ASS_SOURCE,
  SHIFT_JIS_TEST_SRT,
  SRT_REFERENCE,
  subtitleFile,
} from "./subtitle-fixtures";

const UNMATCHED_SOURCE = "1\n00:00:00,000 --> 00:00:01,000\n未対応の声";
const UNMATCHED_REFERENCE =
  "1\n00:00:02,000 --> 00:00:03,000\nAn unmatched reference.";
const GROUPED_SOURCE =
  "1\n00:00:00,000 --> 00:00:02,000\n最初の声\n\n2\n00:00:01,500 --> 00:00:03,000\n次の声";
const GROUPED_REFERENCE =
  "1\n00:00:00,000 --> 00:00:02,200\nFirst reference.\n\n2\n00:00:01,800 --> 00:00:03,000\nSecond reference.";

async function importFiles(page: Page, source: string, reference?: string) {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Upload subtitle files" }).click();
  await page
    .getByLabel("Source subtitle file")
    .setInputFiles(
      subtitleFile(source === ASS_SOURCE ? "source.ass" : "source.srt", source),
    );
  if (reference) {
    await page
      .getByLabel("Reference subtitle file")
      .setInputFiles(subtitleFile("reference.srt", reference));
  }
  await page.getByRole("button", { name: "Parse files" }).click();
  await expect(
    page.getByRole("heading", { name: "PAIRED LINES" }),
  ).toBeVisible();
}

async function saveDraft(page: Page) {
  await page
    .getByRole("button", { name: "Save local draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Local subtitle draft saved." }),
  ).toBeVisible();
}

async function workspaceRecords(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        counts: Record<string, number>;
        preference: { showSpeakerNames: boolean } | undefined;
        importState:
          | {
              failure: unknown;
              draft: {
                ignoredReferenceCueIds: string[];
                activeGroupId: string;
              };
            }
          | undefined;
        artifacts: { name: string; requestedEncoding: string; size: number }[];
      }>((resolve, reject) => {
        const opening = indexedDB.open("moyu-local-review");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const names = [
            "sessions",
            "subtitle-imports",
            "subtitle-artifacts",
            "preferences",
          ];
          const tx = db.transaction(names, "readonly");
          const counts: Record<string, number> = {};
          for (const name of names) {
            const count = tx.objectStore(name).count();
            count.onsuccess = () => {
              counts[name] = count.result;
            };
          }
          const pref = tx.objectStore("preferences").get("workspace");
          const current = tx.objectStore("subtitle-imports").get("current");
          const artifacts = tx.objectStore("subtitle-artifacts").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve({
              counts,
              preference: pref.result,
              importState: current.result,
              artifacts: artifacts.result,
            });
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
}

test("requires explicit outcomes before review and persists ignored references", async ({
  page,
}) => {
  await importFiles(page, UNMATCHED_SOURCE, UNMATCHED_REFERENCE);
  await expect(
    page.getByRole("button", { name: "Start local review" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Keep source-only", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start local review" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Ignore reference cue 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start local review" }),
  ).toBeEnabled();
  await saveDraft(page);
  expect(
    (await workspaceRecords(page)).importState?.draft.ignoredReferenceCueIds,
  ).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByText("1 reference cue explicitly ignored."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start local review" }),
  ).toBeEnabled();
});

test("normal and alignment active rows share the mint semantic treatment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await importFiles(page, ASS_SOURCE, SRT_REFERENCE);
  const token = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent-wash")
      .trim(),
  );
  expect(token).toBe("#e4f1e6");
  const rows = page.getByRole("article");
  await expect(rows.first()).toHaveCSS(
    "background-color",
    "rgb(228, 241, 230)",
  );
  await expect(rows.nth(1)).not.toHaveCSS(
    "background-color",
    "rgb(228, 241, 230)",
  );
  await rows
    .nth(1)
    .getByRole("button", { name: "Accept grouping", exact: true })
    .click();
  await expect(rows.nth(1)).toHaveCSS("background-color", "rgb(228, 241, 230)");
  await expect(
    page.getByRole("heading", { name: "CUES · 1/2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "UNASSIGNED · 0", exact: true }),
  ).toBeVisible();
  expect(
    (await page.locator(".workspace__header").boundingBox())!.height,
  ).toBeLessThanOrEqual(56);
  const fileButton = page.getByRole("button", { name: "Files & encoding" });
  await fileButton.focus();
  await fileButton.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Subtitle files" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(fileButton).toBeFocused();
  await page
    .getByRole("button", { name: "Start local review", exact: true })
    .click();
  await expect(page.locator('article[aria-current="true"]')).toHaveCSS(
    "background-color",
    "rgb(228, 241, 230)",
  );
  await page
    .getByRole("navigation", { name: "Dialogue navigator" })
    .getByRole("button")
    .nth(1)
    .click();
  await expect(
    page.getByRole("heading", { name: "DIALOGUE · 2/2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "EVIDENCE · 這是第一架機體",
      exact: true,
    }),
  ).toBeVisible();
});

test("alignment reserves amber for unresolved groups and mint for accepted decisions", async ({
  page,
}) => {
  await importFiles(
    page,
    `${UNMATCHED_SOURCE}\n\n2\n00:00:04,000 --> 00:00:05,000\n別の声`,
    UNMATCHED_REFERENCE,
  );
  const second = page.getByRole("article", {
    name: "Alignment group 2",
    exact: true,
  });
  await expect(second).toHaveCSS("background-color", "rgb(245, 237, 220)");
  await second
    .getByRole("button", { name: "Keep source-only", exact: true })
    .click();
  await expect(second).toHaveCSS("background-color", "rgb(228, 241, 230)");
});

test("small status text remains readable on amber and mint rows", async ({
  page,
}) => {
  await importFiles(
    page,
    `${UNMATCHED_SOURCE}\n\n2\n00:00:04,000 --> 00:00:05,000\n<mystery>別の声</mystery>`,
    UNMATCHED_REFERENCE,
  );
  const row = page.getByRole("article", {
    name: "Alignment group 2",
    exact: true,
  });
  await expect(row.locator(".workspace__cue-warning")).toBeVisible();
  for (const decision of ["pending", "source-only"]) {
    if (decision === "source-only") {
      await row
        .getByRole("button", { name: "Keep source-only", exact: true })
        .click();
    }
    for (const label of await row
      .locator(
        '[data-slot="badge"], .workspace__cue-warning, .workspace__muted, .workspace__group-summary',
      )
      .all()) {
      const contrast = await label.evaluate((element) => {
        const context = document.createElement("canvas").getContext("2d")!;
        function rgba(color: string) {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        }
        let background = [255, 255, 255, 255];
        const ancestors: Element[] = [];
        for (
          let current: Element | null = element;
          current;
          current = current.parentElement
        )
          ancestors.unshift(current);
        for (const ancestor of ancestors) {
          const layer = rgba(getComputedStyle(ancestor).backgroundColor);
          const alpha = layer[3] / 255;
          background = background.map((channel, index) =>
            index === 3 ? 255 : layer[index] * alpha + channel * (1 - alpha),
          );
        }
        function luminance(color: number[]) {
          const channels = color.slice(0, 3).map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
          return (
            channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
          );
        }
        const foreground = luminance(rgba(getComputedStyle(element).color));
        const behind = luminance(background);
        return (
          (Math.max(foreground, behind) + 0.05) /
          (Math.min(foreground, behind) + 0.05)
        );
      });
      expect
        .soft(contrast, `${decision}: ${await label.textContent()}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  }
});

for (const width of [1280, 320, 375, 414, 768]) {
  test(`${width}px workbench keeps keyboard focus and the accepted rendered surfaces`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await importFiles(page, ASS_SOURCE, SRT_REFERENCE);
    await page.screenshot({
      path: testInfo.outputPath("alignment.png"),
      animations: "disabled",
    });
    const files = page.getByRole("button", { name: "Files & encoding" });
    await files.focus();
    await files.press("Enter");
    const modal = page.getByRole("dialog", { name: "Subtitle files" });
    await expect(modal).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("file-modal.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(files).toBeFocused();
    await expect(files).toHaveCSS("outline-style", "solid");
    await expect(files).toHaveCSS("outline-width", "2px");
    await page
      .getByRole("button", { name: "Start local review", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Continuous dialogue review" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("review.png"),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Clear session", exact: true })
      .click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Clear session", exact: true }),
    ).toBeFocused();
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Continuous dialogue review" }),
    ).toBeVisible();
  });
}

test("accepts, splits, attaches, detaches, and chooses a nearby reference", async ({
  page,
}) => {
  await importFiles(page, GROUPED_SOURCE, GROUPED_REFERENCE);
  await expect(
    page.getByRole("button", { name: "Start local review" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Accept grouping", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start local review" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Split source", exact: true }).click();
  await expect(
    page.getByRole("article", { name: /Alignment group/ }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Start local review" }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Attach reference cue 1 to active group",
      exact: true,
    })
    .click();
  const first = page.getByRole("article", {
    name: "Alignment group 1",
    exact: true,
  });
  await expect(first).toContainText("First reference.");
  await first
    .getByRole("button", { name: "Detach reference cue 1", exact: true })
    .click();
  await expect(first).not.toContainText("First reference.");
  await first
    .getByRole("button", { name: "Choose nearby cue", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Choose nearby cue",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await picker
    .getByRole("button", { name: "Use reference cue 1 as match", exact: true })
    .click();
  await expect(first).toContainText("First reference.");
  await page
    .getByRole("article", { name: "Alignment group 2", exact: true })
    .getByRole("button", { name: "Keep source-only", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ignore reference cue 2", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start local review" }),
  ).toBeEnabled();
});

test("restores draft, encoding, current row, and speaker preference after reload", async ({
  page,
}) => {
  await importFiles(page, ASS_SOURCE, SRT_REFERENCE);
  await expect(page.getByText("玲奈", { exact: true })).toBeVisible();
  await page.getByLabel("Show speaker names").click();
  await expect(page.getByText("玲奈", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Cue 2/ }).click();
  await saveDraft(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "PAIRED LINES" }),
  ).toBeVisible();
  await expect(page.getByLabel("Show speaker names")).not.toBeChecked();
  await expect(page.getByRole("button", { name: /Cue 2/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("button", { name: "Files & encoding" }).click();
  await expect(page.getByLabel("Source encoding")).toContainText("UTF-8");
  await expect(
    page.getByText("source.ass · ASS · local only", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("reference.srt · SRT · local only", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use paste instead" }).click();
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  await page.getByRole("button", { name: "Resume subtitle draft" }).click();
  await expect(
    page.getByRole("heading", { name: "PAIRED LINES" }),
  ).toBeVisible();
});

test("recovers a Shift-JIS file only after explicit encoding selection and reload", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Upload subtitle files" }).click();
  await page.getByLabel("Source subtitle file").setInputFiles({
    name: "legacy.srt",
    mimeType: "text/plain",
    buffer: SHIFT_JIS_TEST_SRT,
  });
  await page.getByRole("button", { name: "Parse files" }).click();
  await expect(
    page.getByText("The file is not valid utf-8.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Subtitle files" }),
  ).toBeVisible();
  await expect(
    page.getByText("The file is not valid utf-8.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Source encoding").click();
  await page.getByRole("option", { name: "Shift-JIS", exact: true }).click();
  await page.getByRole("button", { name: "Parse files" }).click();
  await expect(page.getByText("テスト", { exact: true })).toBeVisible();
  await saveDraft(page);
  await page.reload();
  await page.getByRole("button", { name: "Files & encoding" }).click();
  await expect(page.getByLabel("Source encoding")).toContainText("Shift-JIS");
});

test("reverts a failed encoding replacement to the previous parsed artifact and encoding", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Upload subtitle files" }).click();
  await page.getByLabel("Source subtitle file").setInputFiles({
    name: "legacy.srt",
    mimeType: "text/plain",
    buffer: SHIFT_JIS_TEST_SRT,
  });
  await page.getByLabel("Source encoding").click();
  await page.getByRole("option", { name: "Shift-JIS", exact: true }).click();
  await page.getByRole("button", { name: "Parse files" }).click();
  await expect(page.getByText("テスト", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Files & encoding" }).click();
  await page.getByLabel("Source encoding").click();
  await page.getByRole("option", { name: "UTF-8", exact: true }).click();
  await page.getByRole("button", { name: "Re-align files" }).click();
  await expect(
    page.getByText("The file is not valid utf-8.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep previous parsed file" }).click();
  await expect(page.getByText("テスト", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Files & encoding" }).click();
  await expect(page.getByLabel("Source encoding")).toContainText("Shift-JIS");
  const records = await workspaceRecords(page);
  expect(records.artifacts).toHaveLength(1);
  expect(records.artifacts[0].requestedEncoding).toBe("shift_jis");
  expect(records.importState?.failure).toBeNull();
});

test("keeps a usable draft through failed replacement, retries, and reverts only the failed artifact", async ({
  page,
}) => {
  await importFiles(page, ASS_SOURCE, SRT_REFERENCE);
  await page.getByRole("button", { name: "Files & encoding" }).click();
  await page
    .getByLabel("Source subtitle file")
    .setInputFiles(subtitleFile("broken.ass", "[Script Info]\nNo events here"));
  await page.getByRole("button", { name: "Re-align files" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not parse source subtitles" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("broken.ass · ASS · local only", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Re-align files" }).click();
  await expect(
    page.getByRole("button", { name: "Keep previous parsed file" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep previous parsed file" }).click();
  await expect(
    page.getByRole("heading", { name: "PAIRED LINES" }),
  ).toBeVisible();
  await expect(page.getByText("我已經等了很久", { exact: true })).toBeVisible();
  let records = await workspaceRecords(page);
  expect(records.artifacts.map((artifact) => artifact.name).sort()).toEqual([
    "reference.srt",
    "source.ass",
  ]);
  expect(records.importState?.failure).toBeNull();
  await page.getByRole("button", { name: "Files & encoding" }).click();
  await page
    .getByLabel("Source subtitle file")
    .setInputFiles(
      subtitleFile(
        "replaced.ass",
        ASS_SOURCE.replace("我已經等了很久", "新的台詞"),
      ),
    );
  await page.getByRole("button", { name: "Re-align files" }).click();
  await expect(page.getByText("新的台詞", { exact: true })).toBeVisible();
  records = await workspaceRecords(page);
  expect(records.artifacts.map((artifact) => artifact.name).sort()).toEqual([
    "reference.srt",
    "replaced.ass",
  ]);
});

test("reopens and reapplies a subtitle review without losing Evidence or the previous review", async ({
  page,
}) => {
  await importFiles(page, ASS_SOURCE, SRT_REFERENCE);
  await page.getByRole("button", { name: "Start local review" }).click();
  await expect(
    page.getByRole("heading", { name: "PAIRED LINES" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Evidence", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("玲奈", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Review alignment", exact: true })
    .click();
  const first = page.getByRole("article", {
    name: "Alignment group 1",
    exact: true,
  });
  await first
    .getByRole("button", { name: "Keep source-only", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ignore reference cue 1", exact: true })
    .click();
  await page.getByLabel("Show speaker names").click();
  await saveDraft(page);
  await page
    .getByRole("button", { name: "Back to review", exact: true })
    .click();
  await expect(page.locator("article").first()).toContainText(
    "Tôi đã đợi rất lâu rồi.",
  );
  await expect(page.getByText("玲奈", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "PAIRED LINES" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review alignment", exact: true })
    .click();
  await expect(first).not.toContainText("Tôi đã đợi rất lâu rồi.");
  await page.getByRole("button", { name: "Files & encoding" }).click();
  await expect(
    page.getByText("source.ass · ASS · local only", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Start local review" }).click();
  await expect(page.locator("article").first()).not.toContainText(
    "Tôi đã đợi rất lâu rồi.",
  );
  await expect(
    page.getByRole("region", { name: "Evidence", exact: true }),
  ).toContainText("我已經等了很久");
  await expect(
    page.getByRole("complementary", { name: "Unassigned references" }),
  ).toHaveCount(0);
});

for (const role of ["Source", "Reference"] as const) {
  test(`requires re-alignment after changing the ${role.toLowerCase()} language`, async ({
    page,
  }) => {
    await importFiles(page, ASS_SOURCE, SRT_REFERENCE);
    await page.getByRole("button", { name: "Files & encoding" }).click();
    await page.getByLabel(`${role} language`).click();
    await page
      .getByRole("option", {
        name: role === "Source" ? "Chinese" : "Vietnamese",
        exact: true,
      })
      .click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Start local review" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("alert").filter({ hasText: "Re-align files" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Start local review" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Files & encoding" }).click();
    await page.getByRole("button", { name: "Re-align files" }).click();
    await page.getByRole("button", { name: "Start local review" }).click();
    await expect(
      page.getByRole("region", { name: "Evidence", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator("article .workspace__line-text")
        .first()
        .locator("p")
        .nth(role === "Source" ? 0 : 1),
    ).toHaveAttribute("lang", role === "Source" ? "zh" : "vi");
  });
}

test("restores a source-only draft after a failed reference addition", async ({
  page,
}) => {
  await importFiles(page, ASS_SOURCE);
  for (const row of await page.getByRole("article").all()) {
    await row
      .getByRole("button", { name: "Keep source-only", exact: true })
      .click();
  }
  await expect(
    page.getByRole("button", { name: "Start local review" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Files & encoding" }).click();
  await page
    .getByLabel("Reference subtitle file")
    .setInputFiles(
      subtitleFile("broken-reference.ass", "[Script Info]\nNo events here"),
    );
  await page.getByRole("button", { name: "Re-align files" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Could not parse reference subtitles" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Keep source-only draft", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Subtitle files" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start local review" }),
  ).toBeEnabled();
  const records = await workspaceRecords(page);
  expect(records.importState?.failure).toBeNull();
  expect(records.artifacts.map((artifact) => artifact.name)).toEqual([
    "source.ass",
  ]);
  await page.reload();
  await expect(
    page.getByText("No reference file", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start local review" }).click();
  await expect(
    page.getByRole("region", { name: "Evidence", exact: true }),
  ).toBeVisible();
});

test("retries a temporary artifact storage failure without reselecting the file", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Upload subtitle files" }).click();
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (args[1] === "readwrite") {
        IDBDatabase.prototype.transaction = transaction;
        throw new DOMException(
          "Synthetic storage failure",
          "QuotaExceededError",
        );
      }
      return transaction.apply(this, args);
    };
  });
  await page
    .getByLabel("Source subtitle file")
    .setInputFiles(subtitleFile("source.ass", ASS_SOURCE));
  await expect(
    page
      .getByRole("dialog", { name: "Subtitle files" })
      .getByRole("alert")
      .filter({ hasText: "Browser storage is unavailable" }),
  ).toBeVisible();
  expect((await workspaceRecords(page)).artifacts).toHaveLength(0);
  await page.getByRole("button", { name: "Parse files" }).click();
  await expect(
    page.getByRole("heading", { name: "PAIRED LINES" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "PAIRED LINES" }),
  ).toBeVisible();
  expect(
    (await workspaceRecords(page)).artifacts.map((artifact) => artifact.name),
  ).toEqual(["source.ass"]);
});

test("confirmed Clear removes review, import, and artifacts but keeps speaker settings", async ({
  page,
}) => {
  await importFiles(page, ASS_SOURCE, SRT_REFERENCE);
  await page.getByLabel("Show speaker names").click();
  await page.getByRole("button", { name: "Start local review" }).click();
  await page
    .getByRole("button", { name: "Clear session", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep session", exact: true }).click();
  expect((await workspaceRecords(page)).counts.sessions).toBe(1);
  await page
    .getByRole("button", { name: "Clear session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear local session", exact: true })
    .click();
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  const records = await workspaceRecords(page);
  expect(records.counts).toEqual({
    sessions: 0,
    "subtitle-imports": 0,
    "subtitle-artifacts": 0,
    preferences: 1,
  });
  expect(records.preference).toEqual({ showSpeakerNames: false });
  await page.reload();
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume subtitle draft" }),
  ).toHaveCount(0);
});

test("the file modal confirms draft Clear and supports keyboard cancellation", async ({
  page,
}) => {
  await importFiles(page, ASS_SOURCE, SRT_REFERENCE);
  await page.getByRole("button", { name: "Files & encoding" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Subtitle files" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Files & encoding" }).click();
  await page
    .getByRole("button", { name: "Clear local draft", exact: true })
    .click();
  await expect(
    page.getByRole("alertdialog", { name: "Clear this local draft?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep draft", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect((await workspaceRecords(page)).counts["subtitle-imports"]).toBe(1);
  await page
    .getByRole("button", { name: "Clear local draft", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Clear local draft", exact: true })
    .click();
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  expect((await workspaceRecords(page)).counts["subtitle-artifacts"]).toBe(0);
});

test("never sends subtitle files or derived data through the full local workflow", async ({
  page,
}) => {
  const outgoing: { url: string; serialized: string }[] = [];
  await page.goto("/workspace");
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  page.on("request", (request) => {
    outgoing.push({
      url: request.url(),
      serialized: `${decodeURIComponent(request.url())}\n${request.method()}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ""}`,
    });
  });
  const privateSource = ASS_SOURCE.replace("玲奈", "秘密話者-91")
    .replace("我已經等了很久", "秘密字幕-7e91")
    .replace("這是第一架機體", "BYTE-MARKER-a61c");
  const privateReference = SRT_REFERENCE.replace(
    "Tôi đã đợi rất lâu rồi.",
    "Private reference 3b42",
  );
  await page.getByRole("button", { name: "Upload subtitle files" }).click();
  await page
    .getByLabel("Source subtitle file")
    .setInputFiles(subtitleFile("private-source-7e91.ass", privateSource));
  await page
    .getByLabel("Reference subtitle file")
    .setInputFiles(
      subtitleFile("private-reference-3b42.srt", privateReference),
    );
  await page.getByRole("button", { name: "Parse files" }).click();
  await expect(page.getByText("秘密字幕-7e91", { exact: true })).toBeVisible();
  await expect(page.getByText("秘密話者-91", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Private reference 3b42", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("article", { name: "Alignment group 1", exact: true })
    .getByRole("button", { name: "Keep source-only", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ignore reference cue 1", exact: true })
    .click();
  await saveDraft(page);
  await page.reload();
  await expect(
    page.getByText("1 reference cue explicitly ignored."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start local review" }).click();
  await expect(
    page.getByRole("region", { name: "Continuous dialogue review" }),
  ).toContainText("BYTE-MARKER-a61c");
  await page
    .getByRole("button", { name: "Clear session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear local session", exact: true })
    .click();
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  expect((await workspaceRecords(page)).counts).toMatchObject({
    sessions: 0,
    "subtitle-imports": 0,
    "subtitle-artifacts": 0,
  });
  for (const marker of [
    "private-source-7e91.ass",
    "private-reference-3b42.srt",
    "秘密字幕-7e91",
    "Private reference 3b42",
    "秘密話者-91",
    "BYTE-MARKER-a61c",
    "0:00:01.00",
    "sourceCueIds",
    "ignoredReferenceCueIds",
    privateSource,
    privateReference,
  ]) {
    expect(
      outgoing.some((request) => request.serialized.includes(marker)),
      marker,
    ).toBe(false);
  }
  expect(
    outgoing.filter((request) =>
      new URL(request.url).pathname.startsWith("/api/"),
    ),
  ).toEqual([]);
});

test("parses and reviews local subtitles offline after the worker is loaded", async ({
  page,
  context,
}) => {
  await page.goto("/workspace");
  const workerCreated = page.waitForEvent("worker");
  await page.getByRole("button", { name: "Upload subtitle files" }).click();
  const worker = await workerCreated;
  // Evaluation waits for the real worker execution context, without replacing its processor.
  await worker.evaluate(() => self.location.href);
  await expect(
    page.getByRole("dialog", { name: "Subtitle files" }),
  ).toBeVisible();
  await context.setOffline(true);
  const processingRequests: string[] = [];
  page.on("request", (request) => processingRequests.push(request.url()));
  try {
    await page
      .getByLabel("Source subtitle file")
      .setInputFiles(subtitleFile("offline-local.srt", UNMATCHED_SOURCE));
    await page
      .getByRole("button", { name: "Parse files", exact: true })
      .click();
    const group = page.getByRole("article", {
      name: "Alignment group 1",
      exact: true,
    });
    await expect(group).toContainText("未対応の声");
    await group
      .getByRole("button", { name: "Keep source-only", exact: true })
      .click();
    await saveDraft(page);
    await page
      .getByRole("button", { name: "Start local review", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Continuous dialogue review" }),
    ).toContainText("未対応の声");
    expect((await workspaceRecords(page)).counts).toMatchObject({
      sessions: 1,
      "subtitle-imports": 1,
      "subtitle-artifacts": 1,
    });
    expect(
      processingRequests.filter((url) =>
        new URL(url).pathname.startsWith("/api/"),
      ),
    ).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});

test("keeps paste and adds a mixed-format local subtitle workflow", async ({
  page,
}) => {
  await page.goto("/workspace");
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  await page.getByRole("button", { name: "Upload subtitle files" }).click();
  await expect(
    page.getByRole("dialog", { name: "Subtitle files" }),
  ).toBeVisible();

  await page
    .getByLabel("Source subtitle file")
    .setInputFiles(subtitleFile("episode.zh.ASS", ASS_SOURCE));
  await page.getByLabel("Source language").click();
  await page.getByRole("option", { name: "Chinese" }).click();
  await page
    .getByLabel("Reference subtitle file")
    .setInputFiles(subtitleFile("episode.vi.srt", SRT_REFERENCE));
  await page.getByLabel("Reference language").click();
  await page.getByRole("option", { name: "Vietnamese" }).click();
  await page.getByRole("button", { name: "Parse files" }).click();

  await expect(
    page.getByRole("heading", { name: "PAIRED LINES" }),
  ).toBeVisible();
  await expect(page.getByText("我已經等了很久", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Tôi đã đợi rất lâu rồi.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start local review" }),
  ).toBeEnabled();
});

test("source-only upload still enters the mandatory preview", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Upload subtitle files" }).click();
  await page
    .getByLabel("Source subtitle file")
    .setInputFiles(subtitleFile("source.srt", SRT_REFERENCE));
  await page.getByRole("button", { name: "Parse files" }).click();
  await expect(
    page.getByRole("heading", { name: "PAIRED LINES" }),
  ).toBeVisible();
  await expect(
    page.getByText("No reference file", { exact: true }),
  ).toBeVisible();
});

const SPEAKERLESS_SRT_SOURCE = `1
00:00:01,000 --> 00:00:03,000
SOURCE-SRT-TEXT-UNCHANGED-517`;

const SPEAKERED_ASS_REFERENCE = `[Events]
Format: Start, End, Actor, Text
Dialogue: 0:00:01.00,0:00:03.00,REFERENCE-ATTACHED-SPEAKER-517,REFERENCE-ATTACHED-TEXT-UNCHANGED-517
Dialogue: 0:00:07.00,0:00:08.00,REFERENCE-UNASSIGNED-SPEAKER-517,REFERENCE-UNASSIGNED-TEXT-UNCHANGED-517`;

async function importSpeakeredAssReference(page: Page) {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Upload subtitle files" }).click();
  await page
    .getByLabel("Source subtitle file")
    .setInputFiles(
      subtitleFile("speakerless-source-517.srt", SPEAKERLESS_SRT_SOURCE),
    );
  await page
    .getByLabel("Reference subtitle file")
    .setInputFiles(
      subtitleFile("speakered-reference-517.ass", SPEAKERED_ASS_REFERENCE),
    );
  await page.getByRole("button", { name: "Parse files", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "PAIRED LINES" }),
  ).toBeVisible();
}

async function storedReviewSourceSpeakers(page: Page) {
  return page.evaluate(
    () =>
      new Promise<readonly string[] | undefined>((resolve, reject) => {
        const opening = indexedDB.open("moyu-local-review");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const transaction = db.transaction("sessions", "readonly");
          const request = transaction.objectStore("sessions").get("active");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const session = request.result as
              | {
                  lines?: readonly {
                    subtitle?: { speakers?: readonly string[] };
                  }[];
                }
              | undefined;
            resolve(session?.lines?.[0]?.subtitle?.speakers);
          };
          transaction.oncomplete = () => db.close();
        };
      }),
  );
}

test("reference ASS speaker preference covers attached, unassigned, and nearby desktop cues", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await importSpeakeredAssReference(page);

  const attached = page.getByRole("article", {
    name: "Alignment group 1",
    exact: true,
  });
  const tray = page.getByRole("complementary", {
    name: "Unassigned references",
    exact: true,
  });
  await expect(attached).toContainText("REFERENCE-ATTACHED-SPEAKER-517");
  await expect(tray).toContainText("REFERENCE-UNASSIGNED-SPEAKER-517");

  await attached
    .getByRole("button", { name: "Choose nearby cue", exact: true })
    .click();
  const nearby = page.getByRole("dialog", {
    name: "Choose nearby cue",
    exact: true,
  });
  await expect(nearby).toContainText("REFERENCE-UNASSIGNED-SPEAKER-517");
  await page.keyboard.press("Escape");

  const toggle = page.getByLabel("Show speaker names");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(
    page.getByText("REFERENCE-ATTACHED-SPEAKER-517", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("REFERENCE-UNASSIGNED-SPEAKER-517", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("SOURCE-SRT-TEXT-UNCHANGED-517", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("REFERENCE-ATTACHED-TEXT-UNCHANGED-517", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("REFERENCE-UNASSIGNED-TEXT-UNCHANGED-517", { exact: true }),
  ).toBeVisible();

  await saveDraft(page);
  await page.reload();
  await expect(page.getByLabel("Show speaker names")).not.toBeChecked();
  expect((await workspaceRecords(page)).preference).toEqual({
    showSpeakerNames: false,
  });
  await expect(
    page.getByText("SOURCE-SRT-TEXT-UNCHANGED-517", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("REFERENCE-ATTACHED-TEXT-UNCHANGED-517", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Show speaker names").click();
  await expect(attached).toContainText("REFERENCE-ATTACHED-SPEAKER-517");
  await expect(tray).toContainText("REFERENCE-UNASSIGNED-SPEAKER-517");
  await page
    .getByRole("button", { name: "Ignore reference cue 2", exact: true })
    .click();
  await saveDraft(page);
  await page
    .getByRole("button", { name: "Start local review", exact: true })
    .click();
  const review = page.getByRole("region", {
    name: "Continuous dialogue review",
    exact: true,
  });
  await expect(review).toContainText("SOURCE-SRT-TEXT-UNCHANGED-517");
  await expect(review).toContainText("REFERENCE-ATTACHED-TEXT-UNCHANGED-517");
  await expect(review).not.toContainText("REFERENCE-ATTACHED-SPEAKER-517");
  expect(await storedReviewSourceSpeakers(page)).toEqual([]);
});

test("reference ASS speaker preference covers the mobile unassigned tray", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await importSpeakeredAssReference(page);
  await expect(
    page.getByRole("article", {
      name: "Alignment group 1",
      exact: true,
    }),
  ).toContainText("REFERENCE-ATTACHED-SPEAKER-517");

  await page
    .getByRole("button", { name: "Unassigned references (1)", exact: true })
    .click();
  const sheet = page.getByRole("dialog", {
    name: "Unassigned references",
    exact: true,
  });
  await expect(sheet).toContainText("REFERENCE-UNASSIGNED-SPEAKER-517");
  await sheet.getByLabel("Show speaker names").click();
  await expect(
    page.getByText("REFERENCE-ATTACHED-SPEAKER-517", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("REFERENCE-UNASSIGNED-SPEAKER-517", { exact: true }),
  ).toHaveCount(0);
  await expect(sheet).toContainText("REFERENCE-UNASSIGNED-TEXT-UNCHANGED-517");
});

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
    page.getByRole("heading", { name: "Paired lines" }),
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
    page.getByRole("heading", { name: "Paired lines" }),
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
    page.getByRole("heading", { name: "Paired lines" }),
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
    page.getByRole("heading", { name: "Paired lines" }),
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
    page.getByRole("heading", { name: "2 local dialogue entries" }),
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
    page.getByRole("heading", { name: "2 local dialogue entries" }),
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

test("subtitle requests contain no local file or cue data", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.goto("/workspace");
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  page.on("request", (request) => {
    requests.push(
      `${decodeURIComponent(request.url())}\n${JSON.stringify(request.headers())}\n${request.postData() ?? ""}`,
    );
  });
  await page.getByRole("button", { name: "Upload subtitle files" }).click();
  await page
    .getByLabel("Source subtitle file")
    .setInputFiles(subtitleFile("private-byte-sentinel-947.ass", ASS_SOURCE));
  await page
    .getByLabel("Reference subtitle file")
    .setInputFiles(
      subtitleFile("private-reference-sentinel-947.srt", SRT_REFERENCE),
    );
  await page.getByRole("button", { name: "Parse files" }).click();
  await page
    .getByRole("article", { name: "Alignment group 1", exact: true })
    .getByRole("button", { name: "Keep source-only", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ignore reference cue 1", exact: true })
    .click();
  await saveDraft(page);
  await page.reload();
  await page.getByRole("button", { name: "Start local review" }).click();
  await page
    .getByRole("button", { name: "Clear session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear local session", exact: true })
    .click();
  await expect(page.getByLabel("Paste dialogue")).toBeVisible();
  for (const marker of [
    "private-byte-sentinel-947",
    "private-reference-sentinel-947",
    "我已經等了很久",
    "Tôi đã đợi rất lâu rồi.",
    "玲奈",
    "0:00:01.00",
    "sourceCueIds",
    "ignoredReferenceCueIds",
    ASS_SOURCE,
    SRT_REFERENCE,
  ]) {
    expect(
      requests.some((request) => request.includes(marker)),
      marker,
    ).toBe(false);
  }
  expect(requests.some((request) => request.includes("/api/"))).toBe(false);
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
    page.getByRole("heading", { name: "Paired lines" }),
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
    page.getByRole("heading", { name: "Paired lines" }),
  ).toBeVisible();
  await expect(
    page.getByText("No reference file", { exact: true }),
  ).toBeVisible();
});

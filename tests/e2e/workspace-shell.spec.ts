import { expect, test } from "@playwright/test";

test("opens the dialogue workbench from the existing home page", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.getByRole("link", { name: "Open workspace" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(
    page.getByRole("heading", { name: "Start a local review" }),
  ).toBeVisible();
});

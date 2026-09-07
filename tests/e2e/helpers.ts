import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const origin = "http://127.0.0.1:3000";
export const password = "Synthetic-password-安全-123";
export const phraseInput = {
  sourcePhrase: "第一架",
  language: "zh",
  glosses: [{ language: "en", text: "first aircraft" }],
  workTagIds: [],
};
export const emailAddress = () => `e2e-${randomUUID()}@example.test`;

export async function register(page: Page, email = emailAddress()) {
  await page.goto("/sign-up");
  await page.getByLabel("Display name").fill("Synthetic account");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toBeVisible();
  return email;
}

export async function jsonRequest(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method, body },
  );
}

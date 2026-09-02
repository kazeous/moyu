import { expect, test } from "@playwright/test";
import {
  emailAddress,
  jsonRequest,
  origin,
  password,
  register,
} from "./helpers";

test("browser registration, normalized password sign-in, cookies and revocation", async ({
  page,
  context,
}) => {
  const email = await register(page);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "moyu_session")).toMatchObject({
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/sign-in$/);
  expect((await jsonRequest(page, "/api/me/settings")).status).toBe(401);
  await page.getByLabel("Email", { exact: true }).fill(email.toUpperCase());
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toBeVisible();
});

test("magic link uses SMTP capture, fragment confirmation and one-time POST", async ({
  page,
  request,
}) => {
  const email = await register(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("link", { name: "Email me a sign-in link" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in by email", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email.toUpperCase());
  const sent = page.waitForResponse("**/api/auth/magic-link");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  const known = await (await sent).json();
  const unknown = await request.post("/api/auth/magic-link", {
    headers: { Origin: origin },
    data: { email: emailAddress() },
  });
  expect(await unknown.json()).toEqual(known);
  expect(known).toEqual({ ok: true });
  const captured = await request.get(`http://127.0.0.1:3102/?email=${email}`);
  const message = (await captured.json()).message as string;
  const link = message
    .replace(/=\r?\n/g, "")
    .replace(/=3D/g, "=")
    .match(/http:\/\/127\.0\.0\.1:3000\/auth\/confirm#[A-Za-z0-9_-]{43}/)?.[0];
  expect(link).toBeTruthy();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(link!);
  expect((await jsonRequest(page, "/api/me/settings")).status).toBe(401);
  await page.getByRole("button", { name: "Confirm sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toBeVisible();
  const token = link!.split("#")[1];
  expect(requests.every((url) => !url.includes(token))).toBe(true);
  const replay = await request.post("/api/auth/magic-link/verify", {
    headers: { Origin: origin },
    data: { token },
  });
  expect(replay.status()).toBe(401);
  expect((await request.get("/api/auth/magic-link/verify")).status()).toBe(405);
});

test("auth rejects invalid origins, malformed bodies, forbidden fields and rate excess", async ({
  request,
}) => {
  for (const Origin of ["https://evil.example.test", "null", ""]) {
    expect(
      (
        await request.post("/api/auth/sign-in", {
          headers: { Origin },
          data: { email: emailAddress(), password },
        })
      ).status(),
    ).toBe(403);
  }
  expect(
    (
      await request.post("/api/auth/sign-in", {
        headers: { Origin: origin, "Content-Type": "application/json" },
        data: "{",
      })
    ).status(),
  ).toBe(400);
  const email = emailAddress();
  expect(
    (
      await request.post("/api/auth/sign-up", {
        headers: { Origin: origin },
        data: {
          email,
          password,
          displayName: "Test",
          ocrText: "synthetic forbidden value",
        },
      })
    ).status(),
  ).toBe(400);
  const limitedEmail = emailAddress();
  let last;
  for (let i = 0; i < 7; i++)
    last = await request.post("/api/auth/sign-in", {
      headers: { Origin: origin, "x-forwarded-for": `192.0.2.${i}` },
      data: { email: limitedEmail, password },
    });
  expect(last!.status()).toBe(429);
  expect(last!.headers()["retry-after"]).toBeTruthy();
  expect(await last!.json()).toEqual({
    error: "Too many attempts. Try again later.",
  });
});

test("concurrent password operations share a bounded gate across auth routes", async ({
  page,
  request,
}) => {
  const email = await register(page);
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      request.post(index % 2 ? "/api/auth/sign-in" : "/api/auth/sign-up", {
        headers: { Origin: origin },
        data:
          index % 2
            ? { email, password }
            : {
                email: emailAddress(),
                password,
                displayName: "Concurrent account",
              },
      }),
    ),
  );
  const statuses = results.map((response) => response.status());
  expect(statuses).toContain(429);
  expect(statuses.every((status) => [200, 201, 429].includes(status))).toBe(
    true,
  );
  for (const response of results.filter(
    (response) => response.status() === 429,
  ))
    expect(await response.json()).toEqual({
      error: "Too many attempts. Try again later.",
    });
});

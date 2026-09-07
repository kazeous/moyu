import { afterEach, expect, it, vi } from "vitest";
import { useAuthDatabaseFixtures } from "@/test/auth-database";
import { registerAccount } from "@/server/auth/accounts";
import { createSession, getSessionUser } from "@/server/auth/sessions";
import { signIn, signOut } from "./auth-routes";
import { authLimiter } from "./rate-limit";

const fixture = useAuthDatabaseFixtures();
afterEach(() => vi.unstubAllEnvs());

it("sets production session cookie flags through the actual sign-in handler and omits secrets from JSON", async () => {
  const email = fixture.email();
  const password = "Synthetic secure password";
  const user = await registerAccount({
    email,
    password,
    displayName: "HTTP test account",
  });
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ORIGIN", "https://moyu.example.test/");
  const response = await signIn(
    new Request("https://moyu.example.test/api/auth/sign-in", {
      method: "POST",
      headers: {
        Origin: "https://moyu.example.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: ` ${email.toUpperCase()} `, password }),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    user: { id: user.id, email, displayName: user.displayName },
  });
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain("; Secure");
  expect(cookie).toContain("; HttpOnly");
  expect(cookie).toContain("; SameSite=Lax");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("allows session revocation even when the authentication IP bucket is exhausted", async () => {
  const user = await fixture.user();
  const session = await createSession(user.id);
  for (let i = 0; i < 61; i++) authLimiter.allow("shared");
  const response = await signOut(
    new Request("http://localhost:3000/api/auth/sign-out", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        Cookie: `moyu_session=${session.rawToken}`,
      },
      body: "{}",
    }),
  );
  expect(response.status).toBe(200);
  expect(await getSessionUser(session.rawToken)).toBeNull();
  expect(response.headers.get("set-cookie")).toContain(
    "Expires=Thu, 01 Jan 1970",
  );
});

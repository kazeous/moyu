import { afterEach, expect, it, vi } from "vitest";
import { submitAuth } from "./api";

afterEach(() => vi.unstubAllGlobals());

it.each(["<html>proxy unavailable</html>", ""])(
  "normalizes malformed or empty auth responses: %j",
  async (body) => {
    vi.stubGlobal("fetch", async () => new Response(body, { status: 502 }));
    await expect(submitAuth("/api/auth/sign-in", {})).rejects.toThrow(
      "Service unavailable. Please try again.",
    );
  },
);

it("preserves validated server error messages", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({ error: "Invalid email or password." }, { status: 401 }),
  );
  await expect(submitAuth("/api/auth/sign-in", {})).rejects.toThrow(
    "Invalid email or password.",
  );
});

it("distinguishes a connection failure from an invalid service response", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("fetch failed");
  });
  await expect(submitAuth("/api/auth/sign-in", {})).rejects.toThrow(
    "Connection unavailable. Please try again.",
  );
});

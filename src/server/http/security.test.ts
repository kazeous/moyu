import { describe, expect, it } from "vitest";
import { hasValidOrigin, clientIp } from "./origin";
import { createAuthLimiter, createConcurrencyGate } from "./rate-limit";
import { sessionCookie } from "./response";
import { readJson, requireEmptyBody } from "./body";
import { z } from "zod";

describe("HTTP security", () => {
  it("treats an empty DELETE stream as bodyless and rejects any nonempty body", async () => {
    await expect(
      requireEmptyBody(
        new Request("https://moyu.example.test", {
          method: "DELETE",
          body: "",
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      requireEmptyBody(
        new Request("https://moyu.example.test", {
          method: "DELETE",
          body: "private",
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("compares configured URL origins while rejecting missing and foreign origin", () => {
    const request = (origin?: string) =>
      new Request("https://moyu.example.test/api", {
        headers: origin ? { Origin: origin } : {},
      });
    expect(
      hasValidOrigin(
        request("https://moyu.example.test"),
        "https://moyu.example.test/",
      ),
    ).toBe(true);
    for (const origin of [
      undefined,
      "null",
      "https://evil.example.test",
      "https://moyu.example.test.evil.test",
      "https://moyu.example.test/path",
    ])
      expect(
        hasValidOrigin(request(origin), "https://moyu.example.test/"),
      ).toBe(false);
  });
  it("ignores forwarded IPs by default, requires a single valid overwritten address when trusted", () => {
    const request = new Request("https://moyu.example.test", {
      headers: { "x-forwarded-for": "192.0.2.1" },
    });
    expect(clientIp(request, false)).toBe("shared");
    expect(clientIp(request, true)).toBe("192.0.2.1");
    for (const value of ["192.0.2.1, 192.0.2.2", "invalid", ""])
      expect(
        clientIp(
          new Request("https://moyu.example.test", {
            headers: { "x-forwarded-for": value },
          }),
          true,
        ),
      ).toBe("shared");
  });
  it("limits IP and normalized email independently without unbounded memory and recovers after expiry", () => {
    let now = 0;
    const limiter = createAuthLimiter({
      ipLimit: 2,
      emailLimit: 2,
      capacity: 6,
      windowMs: 1000,
      now: () => now,
    });
    expect(limiter.allow("ip-a", " A@EXAMPLE.TEST ")).toBe(true);
    expect(limiter.allow("ip-b", "a@example.test")).toBe(true);
    expect(limiter.allow("ip-c", "a@example.test")).toBe(false);
    expect(limiter.allow("ip-a", "b@example.test")).toBe(true);
    expect(limiter.allow("ip-a", "c@example.test")).toBe(false);
    const bounded = createAuthLimiter({
      ipLimit: 9,
      emailLimit: 9,
      capacity: 2,
      windowMs: 1000,
      now: () => now,
    });
    expect(bounded.allow("one", "one@example.test")).toBe(true);
    expect(bounded.allow("two", "two@example.test")).toBe(false);
    now = 1001;
    expect(bounded.allow("two", "two@example.test")).toBe(true);
    expect(limiter.allow("ip-a", "a@example.test")).toBe(true);
  });
  it("rejects excess expensive auth operations and releases slots after failure", async () => {
    const gate = createConcurrencyGate(1);
    let finish!: () => void;
    const first = gate.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await expect(gate.run(async () => 2)).rejects.toMatchObject({
      status: 429,
    });
    finish();
    await first;
    await expect(
      gate.run(async () => {
        throw new Error("failure");
      }),
    ).rejects.toThrow("failure");
    await expect(gate.run(async () => 3)).resolves.toBe(3);
  });
  it("sets secure HttpOnly production cookies and matching deletion attributes", () => {
    const cookie = sessionCookie("secret", new Date("2030-01-01"), true);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
    expect(sessionCookie("", new Date(0), true)).toContain(
      "Expires=Thu, 01 Jan 1970",
    );
  });
  it("bounds request streams, rejects malformed JSON and never echoes validation details", async () => {
    const schema = z.object({ name: z.string() }).strict();
    const request = (body: string, type = "application/json") =>
      new Request("https://moyu.example.test", {
        method: "POST",
        headers: { "Content-Type": type },
        body,
      });
    expect(await readJson(request('{"name":"ok"}'), schema)).toEqual({
      name: "ok",
    });
    for (const body of [
      "{",
      '{"name":"ok","ocrText":"private"}',
      "x".repeat(17000),
    ])
      await expect(readJson(request(body), schema)).rejects.toMatchObject({
        status: 400,
        message: "Invalid request.",
      });
    await expect(
      readJson(request('{"name":"ok"}', "text/plain"), schema),
    ).rejects.toMatchObject({ status: 400 });
  });
});

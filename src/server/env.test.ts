import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("returns typed application settings and coerces the SMTP port", () => {
    expect(
      parseEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://moyu:moyu@localhost:5432/moyu",
        APP_ORIGIN: "https://moyu.example.test",
        AUTH_COOKIE_SECRET: "synthetic-test-secret-at-least-32-characters",
        SMTP_HOST: " smtp.example.test ",
        SMTP_PORT: "587",
        SMTP_USER: " synthetic-user ",
        SMTP_PASSWORD: "synthetic-password",
        SMTP_FROM: "moyu@example.test",
      }),
    ).toEqual({
      trustProxy: false,
      databaseUrl: "postgresql://moyu:moyu@localhost:5432/moyu",
      appOrigin: "https://moyu.example.test/",
      authCookieSecret: "synthetic-test-secret-at-least-32-characters",
      smtp: {
        host: "smtp.example.test",
        port: 587,
        user: "synthetic-user",
        password: "synthetic-password",
        from: "moyu@example.test",
      },
    });
  });

  it("rejects a non-HTTPS production origin", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "production", APP_ORIGIN: "http://moyu.example" }),
    ).toThrow("APP_ORIGIN must use https in production");
  });

  it("labels an invalid origin as an environment validation error", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "development", APP_ORIGIN: "not a URL" }),
    ).toThrow("APP_ORIGIN must be a valid URL");
  });
});

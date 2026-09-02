import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
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

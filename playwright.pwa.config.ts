import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/pwa",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          firefoxUserPrefs: {
            "extensions.enabledScopes": 1,
            "extensions.autoDisableScopes": 15,
          },
        },
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "node tests/pwa/server.mjs",
    url: "http://127.0.0.1:3100/workspace",
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: "postgresql://moyu:moyu@localhost:5432/moyu",
      APP_ORIGIN: "https://moyu.example.test",
      AUTH_COOKIE_SECRET:
        "synthetic-test-secret-at-least-thirty-two-characters",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "3103",
      SMTP_USER: "test",
      SMTP_PASSWORD: "test",
      SMTP_FROM: "moyu@example.test",
    },
  },
});

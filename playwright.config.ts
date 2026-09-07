import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 30_000,
  webServer: [
    {
      command: "node tests/e2e/smtp-capture.mjs",
      url: "http://127.0.0.1:3102/health",
      reuseExistingServer: false,
    },
    {
      command: "corepack pnpm dev:e2e",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: "postgresql://moyu:moyu@localhost:5432/moyu",
        APP_ORIGIN: "http://127.0.0.1:3000",
        AUTH_COOKIE_SECRET: "local-test-secret-at-least-thirty-two-characters",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "3103",
        SMTP_USER: "test",
        SMTP_PASSWORD: "test",
        SMTP_FROM: "moyu@example.test",
        TRUST_PROXY: "false",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
});

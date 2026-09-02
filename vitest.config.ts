import { defineConfig } from "vitest/config";

const sourceDirectory = new URL("./src", import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      "@": sourceDirectory,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});

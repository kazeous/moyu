import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      ".superpowers/**",
      "docs/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "public/ocr/v1/**",
      "public/sw.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);

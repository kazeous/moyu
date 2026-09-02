import { expect, it } from "vitest";

import {
  createPhraseInputSchema,
  updateUserSettingsInputSchema,
  workTagInputSchema,
} from "./metadata-contract";

it("rejects dialogue and OCR fields from phrase metadata", () => {
  expect(() =>
    createPhraseInputSchema.parse({
      sourcePhrase: "第一架",
      language: "zh",
      dialogue: "這是第一架機體",
    }),
  ).toThrow();
});

it("accepts permitted phrase metadata", () => {
  expect(
    createPhraseInputSchema.parse({
      sourcePhrase: "第一架",
      language: "zh",
      glosses: [{ language: "en", text: "first unit" }],
      workTagIds: [],
    }),
  ).toMatchObject({ sourcePhrase: "第一架", language: "zh" });
});

it("rejects unknown fields nested in phrase glosses", () => {
  expect(() =>
    createPhraseInputSchema.parse({
      sourcePhrase: "第一架",
      language: "zh",
      glosses: [{ language: "en", text: "first unit", ocrText: "第一架" }],
      workTagIds: [],
    }),
  ).toThrow();
});

it("rejects duplicate gloss languages", () => {
  expect(() =>
    createPhraseInputSchema.parse({
      sourcePhrase: "第一架",
      language: "zh",
      glosses: [
        { language: "en", text: "first unit" },
        { language: "en", text: "first machine" },
      ],
      workTagIds: [],
    }),
  ).toThrow();
});

it("rejects unknown fields from work tags", () => {
  expect(() =>
    workTagInputSchema.parse({
      name: "mecha",
      aliases: ["robots"],
      sourceDialogue: "第一架機體",
    }),
  ).toThrow();
});

it("accepts a bounded work tag", () => {
  expect(
    workTagInputSchema.parse({ name: "mecha", aliases: ["robots"] }),
  ).toEqual({
    name: "mecha",
    aliases: ["robots"],
  });
});

it("accepts only the settings allowlist", () => {
  expect(() =>
    updateUserSettingsInputSchema.parse({
      theme: "dark",
      activeDialogueLine: "第一架機體",
    }),
  ).toThrow();
});

it("accepts a non-dialogue preference", () => {
  expect(updateUserSettingsInputSchema.parse({ theme: "dark" })).toEqual({
    theme: "dark",
  });
});

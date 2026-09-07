import { expect, it } from "vitest";

import {
  createPhraseInputSchema,
  updateUserSettingsInputSchema,
  workTagInputSchema,
} from "./metadata-contract";

const validPhraseInput = {
  sourcePhrase: "第一架",
  language: "zh" as const,
  glosses: [{ language: "en" as const, text: "first unit" }],
  workTagIds: ["11111111-1111-4111-8111-111111111111"],
};

it("requires at least one work tag on an otherwise valid phrase", () => {
  expect(createPhraseInputSchema.safeParse(validPhraseInput).success).toBe(
    true,
  );
  expect(
    createPhraseInputSchema.safeParse({ ...validPhraseInput, workTagIds: [] })
      .success,
  ).toBe(false);
});

it.each([
  ["dialogue", { dialogue: "這是第一架機體" }],
  ["translation", { translation: "This is the first unit" }],
  ["image", { image: "data:image/png;base64,abc" }],
  ["OCR text", { ocrText: "第一架機體" }],
  ["tokens", { tokens: ["第一", "架"] }],
  ["lookup results", { lookupResults: ["first unit"] }],
  ["selection history", { selectionHistory: ["第一架"] }],
])("rejects %s from phrase metadata", (_fieldName, prohibitedField) => {
  expect(() =>
    createPhraseInputSchema.parse({ ...validPhraseInput, ...prohibitedField }),
  ).toThrow();
});

it("accepts permitted phrase metadata", () => {
  expect(createPhraseInputSchema.parse(validPhraseInput)).toMatchObject({
    sourcePhrase: "第一架",
    language: "zh",
  });
});

it("rejects unknown fields nested in phrase glosses", () => {
  expect(() =>
    createPhraseInputSchema.parse({
      ...validPhraseInput,
      glosses: [{ language: "en", text: "first unit", ocrText: "第一架" }],
    }),
  ).toThrow();
});

it("rejects duplicate gloss languages", () => {
  expect(() =>
    createPhraseInputSchema.parse({
      ...validPhraseInput,
      glosses: [
        { language: "en", text: "first unit" },
        { language: "en", text: "first machine" },
      ],
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

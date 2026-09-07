import { describe, expect, it } from "vitest";
import { analyze, createDictionaryIndex, matchPhrases } from "./engine";
import { dictionaryPackSchema, manifestSchema } from "./contracts";

const entry = (
  id: string,
  headword: string,
  text = id,
  readings: string[] = [],
) => ({
  id,
  headwords: [headword],
  readings,
  partsOfSpeech: [],
  senses: [{ language: "en" as const, text }],
});
const index = createDictionaryIndex([
  {
    language: "ja",
    pack: {
      version: 1,
      sourceId: "test-ja",
      entries: [
        entry("cat", "猫", "cat", ["ねこ"]),
        entry("school", "学校"),
        entry("gas", "ガス"),
      ],
    },
  },
  {
    language: "zh",
    pack: {
      version: 1,
      sourceId: "test-zh",
      entries: [
        entry("student", "学生"),
        entry("study", "学"),
        entry("life", "生"),
        entry("cat", "猫", "cat", ["mao1"]),
      ],
    },
  },
]);

describe("local lexical analysis", () => {
  it("conserves every original span including whitespace, emoji and normalization", () => {
    const source = "  猫\r\nｶﾞｽ 🐈\u{20000}！";
    const result = analyze(source, "ja", index);
    expect(result.tokens.map((token) => token.surface).join("")).toBe(source);
    for (const token of result.tokens)
      expect(source.slice(token.start, token.end)).toBe(token.surface);
    expect(
      result.tokens.find((token) => token.surface === "ｶﾞｽ"),
    ).toMatchObject({ lookupKey: "ガス", status: "known" });
  });
  it("keeps Japanese and Chinese evidence separate", () => {
    expect(analyze("猫", "ja", index).tokens[0].entries[0].readings).toEqual([
      "ねこ",
    ]);
    expect(analyze("猫", "zh", index).tokens[0].entries[0].readings).toEqual([
      "mao1",
    ]);
  });
  it("exposes alternate Chinese boundaries and actual unknown spans", () => {
    const result = analyze("学生🛸未知", "zh", index);
    expect(result.tokens[0]).toMatchObject({
      surface: "学生",
      status: "ambiguous",
    });
    expect(result.alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ start: 0, end: 1, surface: "学" }),
      ]),
    );
    expect(
      result.tokens
        .filter((token) => token.status === "unknown")
        .map((token) => token.surface)
        .join(""),
    ).toContain("未知");
    expect(
      result.tokens.find((token) => token.status === "unknown")?.entries,
    ).toEqual([]);
  });
  it("does not invent definitions or readings when only a headword is known", () => {
    const token = analyze("学校", "ja", index).tokens[0];
    expect(token.entries[0].readings).toEqual([]);
    expect(token.entries[0].partsOfSpeech).toEqual([]);
    expect(token.entries[0].senses).toEqual([
      { language: "en", text: "school" },
    ]);
  });
  it("returns an empty analysis for an empty source", () => {
    expect(analyze("", "ja", index).tokens).toEqual([]);
  });
});

it("matches exact phrases by language and selected work tag, retaining overlaps", () => {
  const phrases = [
    {
      id: "a",
      language: "ja" as const,
      sourcePhrase: "学校",
      workTagIds: ["work"],
    },
    {
      id: "b",
      language: "ja" as const,
      sourcePhrase: "学校猫",
      workTagIds: ["work"],
    },
    {
      id: "c",
      language: "zh" as const,
      sourcePhrase: "学校",
      workTagIds: ["work"],
    },
    {
      id: "d",
      language: "ja" as const,
      sourcePhrase: "猫",
      workTagIds: ["other"],
    },
  ];
  expect(matchPhrases("学校猫学校", "ja", phrases, ["work"])).toEqual([
    { phraseId: "b", start: 0, end: 3, surface: "学校猫" },
    { phraseId: "a", start: 0, end: 2, surface: "学校" },
    { phraseId: "a", start: 3, end: 5, surface: "学校" },
  ]);
  expect(matchPhrases("学校", "ja", phrases, [])).toEqual([]);
  expect(
    matchPhrases(
      "ガス",
      "ja",
      [{ id: "e", language: "ja", sourcePhrase: "ｶﾞｽ", workTagIds: ["work"] }],
      ["work"],
    ),
  ).toEqual([]);
});

it("never overlays a phrase through a grapheme or surrogate boundary", () => {
  for (const [source, sourcePhrase] of [
    ["か\u3099", "か"],
    ["ｶﾞ", "ｶ"],
    ["👩‍🚀", "👩"],
    ["🐈", "\ud83d"],
  ]) {
    expect(
      matchPhrases(
        source,
        "ja",
        [{ id: "phrase", language: "ja", sourcePhrase, workTagIds: ["work"] }],
        ["work"],
      ),
    ).toEqual([]);
  }
});

it("rejects malformed public dictionary contracts and nonlocal asset URLs", () => {
  expect(
    dictionaryPackSchema.safeParse({
      version: 1,
      sourceId: "test",
      entries: [entry("a", "")],
    }).success,
  ).toBe(false);
  expect(
    dictionaryPackSchema.safeParse({
      version: 1,
      sourceId: "test",
      entries: [],
      dialogue: "leak",
    }).success,
  ).toBe(false);
  expect(
    manifestSchema.safeParse({
      version: 1,
      sources: [{ url: "https://external.test/lookup" }],
    }).success,
  ).toBe(false);
});

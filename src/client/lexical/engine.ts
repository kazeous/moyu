import type {
  Analysis,
  DictionaryPack,
  Language,
  PhraseMatchInput,
  PhraseOverlay,
  Token,
} from "./contracts";

type Entry = Token["entries"][number];
type LanguageIndex = {
  words: Map<string, Entry[]>;
  maxLength: Map<string, number>;
};
export type DictionaryIndex = Record<Language, LanguageIndex>;
const languageIndex = (): LanguageIndex => ({
  words: new Map(),
  maxLength: new Map(),
});

export function createDictionaryIndex(
  packs: readonly { language: Language; pack: DictionaryPack }[],
): DictionaryIndex {
  const index: DictionaryIndex = { ja: languageIndex(), zh: languageIndex() };
  // Restricted JMdict spelling/reading pairs often share identical senses.
  // Intern those arrays once instead of retaining every parsed copy.
  const senseSets = new Map<string, Entry["senses"]>();
  const stringLists = new Map<string, string[]>();
  function internList(list: string[]) {
    const key = JSON.stringify(list);
    const existing = stringLists.get(key);
    if (existing) return existing;
    stringLists.set(key, list);
    return list;
  }
  for (const { language, pack } of packs) {
    for (const entry of pack.entries) {
      const senseKey = JSON.stringify(entry.senses);
      let senses = senseSets.get(senseKey);
      if (!senses) {
        senses = entry.senses;
        senseSets.set(senseKey, senses);
      }
      const evidence: Entry = {
        ...entry,
        headwords: internList(entry.headwords),
        readings: internList(entry.readings),
        partsOfSpeech: internList(entry.partsOfSpeech),
        senses,
        sourceId: pack.sourceId,
      };
      for (const word of new Set(
        entry.headwords.map((headword) => headword.normalize("NFKC")),
      )) {
        const dictionary = index[language];
        const entries = dictionary.words.get(word);
        if (entries) entries.push(evidence);
        else dictionary.words.set(word, [evidence]);
        const first = String.fromCodePoint(word.codePointAt(0)!);
        dictionary.maxLength.set(
          first,
          Math.max(word.length, dictionary.maxLength.get(first) ?? 0),
        );
      }
    }
  }
  return index;
}

function token(
  source: string,
  start: number,
  end: number,
  entries: Entry[],
): Token {
  const surface = source.slice(start, end);
  return {
    start,
    end,
    surface,
    lookupKey: surface.normalize("NFKC"),
    entries,
    status: entries.length
      ? "known"
      : /^[\p{White_Space}\p{Punctuation}\p{Symbol}]*$/u.test(surface)
        ? "literal"
        : "unknown",
  };
}

/** Dictionary boundaries are candidates, not a claim of grammatical disambiguation. */
export function analyze(
  source: string,
  language: Language,
  index: DictionaryIndex,
): Analysis {
  const graphemes = Array.from(
    new Intl.Segmenter(language, { granularity: "grapheme" }).segment(source),
  );
  const words = Array.from(
    new Intl.Segmenter(language, { granularity: "word" }).segment(source),
  );
  const wordEnds = new Map(
    words.map((part) => [part.index, part.index + part.segment.length]),
  );
  const matches = new Map<number, Token[]>();
  for (let startIndex = 0; startIndex < graphemes.length; startIndex++) {
    const dictionary = index[language];
    const start = graphemes[startIndex].index;
    const first = String.fromCodePoint(
      graphemes[startIndex].segment.normalize("NFKC").codePointAt(0)!,
    );
    const maxLength = dictionary.maxLength.get(first) ?? 0;
    let key = "";
    for (
      let endIndex = startIndex;
      endIndex < graphemes.length && key.length < maxLength;
      endIndex++
    ) {
      const part = graphemes[endIndex];
      key += part.segment.normalize("NFKC");
      const entries = dictionary.words.get(key);
      if (entries?.length) {
        const candidates = matches.get(start) ?? [];
        candidates.push(
          token(source, start, part.index + part.segment.length, entries),
        );
        matches.set(start, candidates);
      }
    }
  }
  const tokens: Token[] = [];
  const alternatives: Token[] = [];
  let position = 0;
  while (position < graphemes.length) {
    const part = graphemes[position];
    const candidates = matches.get(part.index) ?? [];
    const primary = candidates.at(-1);
    if (primary) {
      const competing = candidates.slice(0, -1);
      // Include candidates starting within a primary word (e.g. 学 + 生 vs 学生).
      for (
        let next = position + 1;
        next < graphemes.length && graphemes[next].index < primary.end;
        next++
      ) {
        competing.push(...(matches.get(graphemes[next].index) ?? []));
      }
      const readings = new Set(
        primary.entries.flatMap((entry) => entry.readings),
      );
      tokens.push({
        ...primary,
        status: competing.length || readings.size > 1 ? "ambiguous" : "known",
      });
      alternatives.push(...competing);
      while (
        position < graphemes.length &&
        graphemes[position].index < primary.end
      )
        position++;
    } else {
      let end = part.index + part.segment.length;
      const wordEnd = wordEnds.get(part.index) ?? end;
      position++;
      while (
        position < graphemes.length &&
        graphemes[position].index < wordEnd &&
        !matches.has(graphemes[position].index)
      ) {
        end = graphemes[position].index + graphemes[position].segment.length;
        position++;
      }
      tokens.push(token(source, part.index, end, []));
    }
  }
  return { language, method: "dictionary-longest-match", tokens, alternatives };
}

/** Exact source matching intentionally does not normalize personal phrases. */
export function matchPhrases(
  source: string,
  language: Language,
  phrases: readonly PhraseMatchInput[],
  workTagIds: readonly string[],
): PhraseOverlay[] {
  const tags = new Set(workTagIds);
  const boundaries = new Set(
    Array.from(
      new Intl.Segmenter(language, { granularity: "grapheme" }).segment(source),
      (part) => part.index,
    ),
  );
  boundaries.add(source.length);
  const results: PhraseOverlay[] = [];
  for (const phrase of phrases) {
    if (
      phrase.language !== language ||
      !phrase.sourcePhrase ||
      !phrase.workTagIds.some((id) => tags.has(id))
    )
      continue;
    let start = source.indexOf(phrase.sourcePhrase);
    while (start !== -1) {
      const end = start + phrase.sourcePhrase.length;
      if (boundaries.has(start) && boundaries.has(end))
        results.push({
          phraseId: phrase.id,
          start,
          end,
          surface: source.slice(start, end),
        });
      start = source.indexOf(phrase.sourcePhrase, start + 1);
    }
  }
  return results.sort(
    (a, b) =>
      a.start - b.start ||
      b.end - a.end ||
      a.phraseId.localeCompare(b.phraseId),
  );
}

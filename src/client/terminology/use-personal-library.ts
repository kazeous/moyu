"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { PhraseMatchInput } from "../lexical/contracts";
import { createPersonalLibrary } from "./library";
import { createPendingPhraseStore } from "./pending-store";

export function usePersonalLibrary() {
  const [controller] = useState(() =>
    createPersonalLibrary({
      fetcher: (url, init) => fetch(url, init),
      store: createPendingPhraseStore(
        typeof indexedDB === "undefined" ? undefined : indexedDB,
      ),
    }),
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const matches: PhraseMatchInput[] = useMemo(
    () =>
      snapshot.phrases.map((phrase) => ({
        id: phrase.id,
        language: phrase.language,
        sourcePhrase: phrase.sourcePhrase,
        workTagIds: phrase.workTags.map((tag) => tag.id),
      })),
    [snapshot.phrases],
  );
  return {
    ...snapshot,
    matches,
    load: controller.load,
    savePhrase: controller.savePhrase,
    retryPhrase: controller.retryPhrase,
    addTag: controller.addTag,
  };
}

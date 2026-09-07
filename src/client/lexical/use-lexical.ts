"use client";

import { useEffect, useRef, useState } from "react";
import type { ReviewSession } from "../workspace/model";
import type {
  Analysis,
  DictionarySource,
  PhraseMatchInput,
  PhraseOverlay,
} from "./contracts";
import {
  createLexicalWorkerClient,
  type LexicalWorkerClient,
} from "./worker-client";

const noPhrases: PhraseMatchInput[] = [];
export function useLexical(
  session: ReviewSession,
  phrases: PhraseMatchInput[] = noPhrases,
) {
  const clientRef = useRef<LexicalWorkerClient | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [assets, setAssets] = useState<{
    loading: boolean;
    attempted: boolean;
    sources: DictionarySource[];
    installedIds: string[];
    unavailableIds: string[];
    updateIds: string[];
    downloadBytes: number;
    cacheAvailable: boolean;
  }>({
    loading: true,
    attempted: false,
    sources: [],
    installedIds: [],
    unavailableIds: [],
    updateIds: [],
    downloadBytes: 0,
    cacheAvailable: true,
  });
  const [result, setResult] = useState<{
    key: string;
    analysis: Analysis;
    overlays: PhraseOverlay[];
  } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const line = session.lines.find((line) => line.id === session.activeLineId);
  const key = JSON.stringify([
    line?.id,
    line?.source,
    session.sourceLanguage,
    phrases,
    session.workTagIds,
    attempt,
    assets.sources.map((source) => source.version),
  ]);

  useEffect(() => {
    let active = true;
    let client: LexicalWorkerClient;
    setAssets((current) => ({ ...current, loading: true }));
    try {
      client = createLexicalWorkerClient();
      clientRef.current = client;
    } catch {
      setAssets((current) => ({ ...current, loading: false, attempted: true }));
      return;
    }
    void client
      .request({
        kind: "load",
        id: crypto.randomUUID(),
        language: session.sourceLanguage,
        download: attempt > 0,
      })
      .then((response) => {
        if (!active) return;
        if (response.kind === "loaded") {
          setAssets({
            loading: false,
            attempted: attempt > 0,
            sources: response.sources,
            installedIds: response.installedIds,
            unavailableIds: response.unavailableIds,
            updateIds: response.updateIds,
            downloadBytes: response.downloadBytes,
            cacheAvailable: response.cacheAvailable,
          });
        } else
          setAssets((current) => ({
            ...current,
            loading: false,
            attempted: true,
            installedIds: [],
          }));
      });
    return () => {
      active = false;
      client.dispose();
      clientRef.current = null;
    };
  }, [session.sourceLanguage, attempt]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || assets.loading || !line) return;
    let active = true;
    void client
      .request({
        kind: "analyze",
        id: crypto.randomUUID(),
        source: line.source,
        language: session.sourceLanguage,
        phrases,
        workTagIds: session.workTagIds ?? [],
      })
      .then((response) => {
        if (!active) return;
        if (response.kind === "analyzed") {
          setResult({
            key,
            analysis: response.analysis,
            overlays: response.overlays,
          });
          setFailedKey(null);
        } else if (response.kind === "unavailable") setFailedKey(key);
      });
    return () => {
      active = false;
    };
  }, [key, line, session.sourceLanguage, session.workTagIds, phrases, assets]);

  return {
    ...assets,
    analysis: !assets.loading && result?.key === key ? result.analysis : null,
    overlays: !assets.loading && result?.key === key ? result.overlays : [],
    failed: failedKey === key,
    retry: () => setAttempt((current) => current + 1),
  };
}
export type LexicalState = ReturnType<typeof useLexical>;

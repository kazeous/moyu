"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ReviewSession } from "../workspace/model";
import type { DictionarySource, Token } from "./contracts";
import type { SpanSelection } from "./token-chips";
import type { LexicalState } from "./use-lexical";

function EntryEvidence({
  entry,
  source,
  referenceLanguage,
}: {
  entry: Token["entries"][number];
  source?: DictionarySource;
  referenceLanguage: "en" | "vi";
}) {
  return (
    <div className="lexical__entry">
      <p className="workspace__muted">Dictionary form / lemma</p>
      <h4>{entry.headwords.join(" · ")}</h4>
      <dl className="lexical__details">
        <div>
          <dt>Reading / pronunciation</dt>
          <dd>
            {entry.readings.length
              ? entry.readings.join(" · ")
              : "Reading unavailable"}
          </dd>
        </div>
        <div>
          <dt>Part of speech</dt>
          <dd>
            {entry.partsOfSpeech.length
              ? entry.partsOfSpeech.join(" · ")
              : "Part of speech unavailable"}
          </dd>
        </div>
      </dl>
      {(
        [referenceLanguage, referenceLanguage === "en" ? "vi" : "en"] as const
      ).map((language) => {
        const senses = entry.senses.filter(
          (sense) => sense.language === language,
        );
        return (
          <div key={language} className="lexical__senses">
            <Badge variant="outline">
              {language === "en" ? "English" : "Vietnamese"}
            </Badge>
            {senses.length ? (
              <ul>
                {senses.map((sense, index) => (
                  <li key={index}>{sense.text}</li>
                ))}
              </ul>
            ) : (
              <p className="workspace__muted">
                {language === "en" ? "English" : "Vietnamese"} definitions
                unavailable in this entry.
              </p>
            )}
          </div>
        );
      })}
      {source ? (
        <details className="lexical__attribution">
          <summary>{source.name}</summary>
          <p>{source.attribution}</p>
          <p>Version {source.version}</p>
          <p>
            <a href={source.sourceUrl} target="_blank" rel="noreferrer">
              Dictionary source
            </a>
            {" · "}
            <a href={source.licenseUrl} target="_blank" rel="noreferrer">
              {source.license}
            </a>
            {" · "}
            <a href={source.noticeUrl} target="_blank" rel="noreferrer">
              Source notice
            </a>
          </p>
          <p>{source.changes}</p>
          <p>{source.updatePolicy}</p>
        </details>
      ) : (
        <p>Source attribution unavailable.</p>
      )}
      {entry.id.startsWith("https://vi.wiktionary.org/wiki/") ? (
        <a href={entry.id.replace(/#.*$/, "")} target="_blank" rel="noreferrer">
          Wiktionary entry and contributors
        </a>
      ) : null}
    </div>
  );
}

export function LexicalEvidencePane({
  session,
  lexical,
  onSelect,
  personal,
}: {
  session: ReviewSession;
  lexical: LexicalState;
  onSelect: (selection: SpanSelection) => void;
  personal?: ReactNode;
}) {
  const line = session.lines.find((line) => line.id === session.activeLineId);
  if (!line)
    return (
      <section className="workspace__evidence" aria-label="Evidence">
        <h2>Choose a line to inspect</h2>
      </section>
    );
  const selection = session.lexicalSelection;
  const surface = selection
    ? line.source.slice(selection.start, selection.end)
    : line.source;
  const tokens = selection
    ? (lexical.analysis?.tokens.filter(
        (token) => token.start >= selection.start && token.end <= selection.end,
      ) ?? [])
    : [];
  const exactAlternative = selection
    ? lexical.analysis?.alternatives.find(
        (token) =>
          token.start === selection.start && token.end === selection.end,
      )
    : undefined;
  const evidenceTokens = exactAlternative ? [exactAlternative] : tokens;
  const alternatives = selection
    ? (lexical.analysis?.alternatives.filter(
        (token) => token.start < selection.end && token.end > selection.start,
      ) ?? [])
    : [];
  const sources = lexical.sources.filter(
    (source) => source.language === session.sourceLanguage,
  );
  const bytes = lexical.downloadBytes;
  return (
    <section className="workspace__evidence" aria-label="Evidence">
      <div className="workspace__evidence-heading">
        <h2 title={surface || "Blank source line"}>
          EVIDENCE · <span>{surface || "Blank source line"}</span>
        </h2>
      </div>
      <Separator />
      <dl className="workspace__evidence-source">
        <div>
          <dt>Surface form</dt>
          <dd lang={session.sourceLanguage}>
            {surface || "Blank source line"}
          </dd>
        </div>
        <div>
          <dt>Source language</dt>
          <dd>{session.sourceLanguage === "ja" ? "Japanese" : "Chinese"}</dd>
        </div>
        {line.reference !== undefined ? (
          <div>
            <dt>
              {session.referenceLanguage === "en" ? "English" : "Vietnamese"}{" "}
              reference
            </dt>
            <dd>{line.reference || "Blank reference line"}</dd>
          </div>
        ) : null}
      </dl>
      <Separator />
      <div className="lexical__body">
        {lexical.overlays.length ? personal : null}
        {lexical.loading ? (
          <p role="status">Opening local dictionaries…</p>
        ) : !lexical.installedIds.length ? (
          <div role="status">
            <h3>Not available yet</h3>
            <p>
              <strong>Lexical assets not installed.</strong> Install
              dictionaries to inspect this line locally.
            </p>
          </div>
        ) : null}
        {!lexical.installedIds.length ||
        lexical.unavailableIds.length ||
        lexical.updateIds.length ? (
          <div className="lexical__install">
            <Button
              onClick={lexical.retry}
              disabled={lexical.loading}
              variant="outline"
            >
              {lexical.updateIds.length
                ? "Update dictionaries"
                : lexical.attempted
                  ? "Retry dictionaries"
                  : "Install dictionaries"}
            </Button>
            {lexical.updateIds.length ? (
              <p className="workspace__muted">
                An update is available. Installed versions remain usable until
                replacements are verified.
              </p>
            ) : null}
            {bytes ? (
              <p className="workspace__muted">
                Download {(bytes / 1024 / 1024).toFixed(1)} MiB to this browser.
                Vietnamese coverage is smaller; missing definitions remain
                explicit.
              </p>
            ) : null}
            {sources.map((source) => (
              <p key={source.id} className="workspace__muted">
                {source.name} · {source.license}
                {lexical.installedIds.includes(source.id) ? " · installed" : ""}
              </p>
            ))}
          </div>
        ) : null}
        {!lexical.cacheAvailable ? (
          <p role="alert">
            Dictionary storage is unavailable. Downloads work for this visit;
            try again to retain them after reload.
          </p>
        ) : null}
        {lexical.failed && lexical.installedIds.length ? (
          <div role="alert">
            <p>Local analysis is unavailable.</p>
            <Button onClick={lexical.retry} variant="outline">
              Retry analysis
            </Button>
          </div>
        ) : null}
        {lexical.installedIds.length ? (
          <>
            <p className="workspace__muted">
              Dictionary-based segmentation. Boundaries and readings can be
              ambiguous; this is not grammatical disambiguation.
            </p>
            {!selection ? (
              <p>Select a token to inspect its dictionary evidence.</p>
            ) : null}
            {evidenceTokens.map((token) => (
              <section
                className="lexical__token-evidence"
                key={`${token.start}:${token.end}`}
              >
                <h3>
                  {token.surface}
                  <Badge variant="outline">
                    {token.status === "known"
                      ? "Dictionary match"
                      : token.status === "ambiguous"
                        ? "Ambiguous"
                        : token.status === "literal"
                          ? "Punctuation / spacing"
                          : "Unknown"}
                  </Badge>
                </h3>
                {!token.entries.length ? (
                  <p>
                    No dictionary evidence for this span. No reading or
                    definition has been inferred.
                  </p>
                ) : (
                  token.entries.map((entry) => (
                    <EntryEvidence
                      key={`${entry.sourceId}:${entry.id}`}
                      entry={entry}
                      source={sources.find(
                        (source) => source.id === entry.sourceId,
                      )}
                      referenceLanguage={session.referenceLanguage}
                    />
                  ))
                )}
              </section>
            ))}
            {alternatives.length ? (
              <details>
                <summary>Competing boundaries ({alternatives.length})</summary>
                <div className="lexical__chips">
                  {alternatives.map((token) => (
                    <Button
                      key={`${token.start}:${token.end}`}
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onSelect({ start: token.start, end: token.end })
                      }
                    >
                      {token.surface} ({token.start}–{token.end})
                    </Button>
                  ))}
                </div>
              </details>
            ) : null}
          </>
        ) : null}
        {!lexical.overlays.length ? personal : null}
      </div>
    </section>
  );
}

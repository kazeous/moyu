"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { ReviewSession } from "../workspace/model";
import type { Token } from "./contracts";
import type { LexicalState } from "./use-lexical";

export type SpanSelection = { start: number; end: number };
export function TokenChips({
  lexical,
  session,
  onSelect,
}: {
  lexical: LexicalState;
  session: ReviewSession;
  onSelect: (selection: SpanSelection) => void;
}) {
  const [extendSelection, setExtendSelection] = useState(false);
  const line = session.lines.find((line) => line.id === session.activeLineId);
  if (!line) return null;
  const tokens = lexical.installedIds.length ? lexical.analysis?.tokens : null;
  const overlayChips = lexical.overlays.length ? (
    <div
      className="lexical__chips"
      role="group"
      aria-label="Preferred phrase overlays"
    >
      {lexical.overlays.map((overlay) => (
        <Button
          key={`${overlay.phraseId}:${overlay.start}`}
          variant="outline"
          size="sm"
          className="lexical__token"
          aria-label={`Inspect personal phrase: ${overlay.surface}`}
          onClick={(event) => {
            event.stopPropagation();
            onSelect({ start: overlay.start, end: overlay.end });
          }}
        >
          Preferred · {overlay.surface}
        </Button>
      ))}
    </div>
  ) : null;
  function select(token: Token, extend: boolean) {
    const current = session.lexicalSelection;
    onSelect(
      extend && current
        ? {
            start: Math.min(current.start, token.start),
            end: Math.max(current.end, token.end),
          }
        : { start: token.start, end: token.end },
    );
  }
  if (!tokens)
    return (
      <div className="workspace__line-active-note">
        {overlayChips}
        <span>
          {lexical.loading
            ? "Opening local dictionaries…"
            : "Unprocessed source span"}
        </span>
        <Button
          aria-label={`Inspect unprocessed source span: ${line.source || "Blank line"}`}
          aria-pressed="true"
          className="workspace__raw-span"
          size="sm"
          variant="outline"
          onClick={(event) => {
            event.stopPropagation();
            if (line.source) onSelect({ start: 0, end: line.source.length });
          }}
        >
          <span className="truncate">{line.source || "Blank source line"}</span>
        </Button>
        <span>
          Local token evidence is unavailable until language assets are
          installed.
        </span>
      </div>
    );
  return (
    <div
      className="lexical__tokens"
      onClick={(event) => event.stopPropagation()}
    >
      {overlayChips}
      <p className="workspace__muted">
        Select a token. Shift-select another to inspect an adjacent range.
      </p>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <Checkbox
          checked={extendSelection}
          onCheckedChange={(checked) => setExtendSelection(Boolean(checked))}
        />
        Extend selection
      </label>
      <div className="lexical__chips" role="group" aria-label="Source tokens">
        {tokens.map((token) => (
          <Button
            key={token.start}
            variant="outline"
            size="sm"
            className="lexical__token"
            aria-label={`Inspect token: ${token.surface}`}
            aria-pressed={Boolean(
              session.lexicalSelection &&
              token.start >= session.lexicalSelection.start &&
              token.end <= session.lexicalSelection.end,
            )}
            onClick={(event) =>
              select(token, event.shiftKey || extendSelection)
            }
            data-status={token.status}
          >
            {token.surface.trim() || "␣"}
          </Button>
        ))}
      </div>
    </div>
  );
}

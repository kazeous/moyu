"use client";

import Link from "next/link";
import {
  BookOpenText,
  ClipboardPaste,
  FileUp,
  PanelRight,
  Trash2,
} from "lucide-react";
import {
  type KeyboardEvent,
  type RefCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  createReviewSessionFromLines,
  prepareImport,
  suggestImportMode,
  type ImportedReviewLine,
  type ImportMode,
} from "./import";
import {
  type ReferenceLanguage,
  type ReviewLine,
  type ReviewSession,
  type SourceLanguage,
} from "./model";
import {
  createWorkspacePersistenceQueue,
  type WorkspacePersistenceQueue,
} from "./session-persistence";
import {
  createLocalSessionStore,
  type LocalWorkspaceResult,
  type LocalWorkspaceSnapshot,
} from "./session-store";
import { SubtitleAlignmentWorkspace } from "./subtitle-alignment-workspace";
import { SubtitleFileDialog } from "./subtitle-file-dialog";
import { useSubtitleImport } from "./use-subtitle-import";

type StorageMessage = { tone: "error" | "success"; text: string } | null;
type StorageRecovery = "clear" | "retry" | "retry-clear" | null;

const sourceLanguageLabels: Record<SourceLanguage, string> = {
  ja: "Japanese",
  zh: "Chinese",
};

const referenceLanguageLabels: Record<ReferenceLanguage, string> = {
  en: "English",
  vi: "Vietnamese",
};

function linePreview(line: ReviewLine) {
  return line.source === "" ? "Blank line" : line.source;
}

function EvidencePane({ session }: { session: ReviewSession }) {
  const activeLine = session.lines.find(
    (line) => line.id === session.activeLineId,
  );

  if (!activeLine) {
    return (
      <section className="workspace__evidence" aria-label="Evidence">
        <p className="workspace__eyebrow">Evidence</p>
        <h2>Choose a line to inspect</h2>
        <p className="workspace__muted">
          The evidence panel updates for the selected local line.
        </p>
      </section>
    );
  }

  return (
    <section className="workspace__evidence" aria-label="Evidence">
      <div className="workspace__evidence-heading">
        <div>
          <p className="workspace__eyebrow">Selected line</p>
          <h2>Line {session.lines.indexOf(activeLine) + 1}</h2>
        </div>
        <Badge variant="outline">Local</Badge>
      </div>
      <dl className="workspace__evidence-source">
        <div>
          <dt>Surface form</dt>
          <dd>{activeLine.source || "Blank source line"}</dd>
        </div>
        <div>
          <dt>Source language</dt>
          <dd>{sourceLanguageLabels[session.sourceLanguage]}</dd>
        </div>
        {activeLine.reference !== undefined ? (
          <div>
            <dt>{referenceLanguageLabels[session.referenceLanguage]}</dt>
            <dd>{activeLine.reference || "Blank reference line"}</dd>
          </div>
        ) : null}
      </dl>
      <div className="workspace__unavailable" role="status">
        <p className="workspace__eyebrow">Lexical evidence</p>
        <h3>Not available yet</h3>
        <p>
          <strong>Lexical assets not installed.</strong> This line is ready for
          local analysis. Readings, parts of speech, and definitions will appear
          only when local language assets are installed.
        </p>
      </div>
    </section>
  );
}

function ImportDesk({
  onClearUnreadable,
  onImport,
  onRetryStorage,
  storageRecovery,
  storageMessage,
  onUploadSubtitleFiles,
  onResumeSubtitleDraft,
}: {
  onClearUnreadable: () => void;
  onImport: (session: ReviewSession) => void;
  onRetryStorage: () => void;
  storageRecovery: StorageRecovery;
  storageMessage: StorageMessage;
  onUploadSubtitleFiles: () => void;
  onResumeSubtitleDraft?: () => void;
}) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<ImportMode>("source-only");
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>("ja");
  const [referenceLanguage, setReferenceLanguage] =
    useState<ReferenceLanguage>("en");
  const [attempted, setAttempted] = useState(false);
  const [modeChosen, setModeChosen] = useState(false);
  const [draftLines, setDraftLines] = useState<ImportedReviewLine[] | null>(
    null,
  );

  const prepared = prepareImport(value, mode);
  const suggestion = suggestImportMode(value);
  const invalid = attempted && value === "";

  function handleValueChange(nextValue: string) {
    setValue(nextValue);

    if (nextValue !== "" && !attempted && !modeChosen) {
      setMode(suggestImportMode(nextValue).mode);
    }
  }

  function handleReviewPairs() {
    setAttempted(true);

    if (value === "") {
      return;
    }

    setDraftLines(prepared.lines.map((line) => ({ ...line })));
  }

  function updateDraftLine(
    index: number,
    field: "source" | "reference",
    nextValue: string,
  ) {
    setDraftLines(
      (current) =>
        current?.map((line, lineIndex) =>
          lineIndex === index ? { ...line, [field]: nextValue } : line,
        ) ?? null,
    );
  }

  function handleImport() {
    if (!draftLines) {
      return;
    }

    onImport(
      createReviewSessionFromLines(
        draftLines,
        sourceLanguage,
        referenceLanguage,
        value,
      ),
    );
  }

  if (draftLines) {
    return (
      <div className="workspace__import-page">
        <header className="workspace__header">
          <Link className="workspace__brand" href="/" aria-label="moyu home">
            moyu
          </Link>
          <Link className="workspace__account-link" href="/account">
            Account
          </Link>
        </header>
        <main className="workspace__import-shell">
          <section
            aria-labelledby="pairing-title"
            className="workspace__pairing-card"
          >
            <header className="workspace__pairing-header">
              <div>
                <p className="workspace__eyebrow">Local import preview</p>
                <h1 id="pairing-title">Review and correct pairs</h1>
              </div>
              <Badge variant="outline">
                {draftLines.length}{" "}
                {draftLines.length === 1 ? "entry" : "entries"}
              </Badge>
            </header>
            <p className="workspace__muted">
              These fields remain in this browser. Correct pairing or text
              before the local review session is created.
            </p>
            <FieldGroup className="workspace__pairing-list">
              {draftLines.map((line, index) => (
                <FieldSet className="workspace__pairing-row" key={index}>
                  <FieldLegend variant="label">Entry {index + 1}</FieldLegend>
                  <Field>
                    <FieldLabel htmlFor={`source-entry-${index + 1}`}>
                      Source for entry {index + 1}
                    </FieldLabel>
                    <Textarea
                      id={`source-entry-${index + 1}`}
                      onChange={(event) =>
                        updateDraftLine(index, "source", event.target.value)
                      }
                      value={line.source}
                    />
                  </Field>
                  {mode === "alternating" ? (
                    <Field>
                      <FieldLabel htmlFor={`reference-entry-${index + 1}`}>
                        Reference for entry {index + 1}
                      </FieldLabel>
                      <Textarea
                        id={`reference-entry-${index + 1}`}
                        onChange={(event) =>
                          updateDraftLine(
                            index,
                            "reference",
                            event.target.value,
                          )
                        }
                        value={line.reference ?? ""}
                      />
                    </Field>
                  ) : null}
                </FieldSet>
              ))}
            </FieldGroup>
            <div className="workspace__pairing-actions">
              <Button onClick={() => setDraftLines(null)} variant="outline">
                Back to paste
              </Button>
              <Button onClick={handleImport}>
                <BookOpenText data-icon="inline-start" aria-hidden="true" />
                Start local review
              </Button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="workspace__import-page">
      <header className="workspace__header">
        <Link className="workspace__brand" href="/" aria-label="moyu home">
          moyu
        </Link>
        <Link className="workspace__account-link" href="/account">
          Account
        </Link>
      </header>
      <main className="workspace__import-shell">
        <Empty className="workspace__import-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardPaste aria-hidden="true" />
            </EmptyMedia>
            <h1 className="workspace__import-title">Start a local review</h1>
            <EmptyDescription>
              Paste source dialogue and optional references. It stays in this
              browser and is never included in a server request.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="workspace__import-content">
            <FieldGroup>
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="dialogue-import">
                  Paste dialogue
                </FieldLabel>
                <Textarea
                  id="dialogue-import"
                  aria-describedby="dialogue-import-help"
                  aria-invalid={invalid || undefined}
                  className="workspace__import-textarea"
                  onChange={(event) => handleValueChange(event.target.value)}
                  placeholder="日本語または中文\nEnglish or Vietnamese reference"
                  value={value}
                />
                <FieldDescription id="dialogue-import-help">
                  Keep one entry per line. You can edit the paste above before
                  confirming how lines are paired.
                </FieldDescription>
                {invalid ? (
                  <FieldError>Paste at least one line to begin.</FieldError>
                ) : null}
              </Field>

              <Field>
                <FieldLabel>Import format</FieldLabel>
                <ToggleGroup
                  aria-label="Import format"
                  onValueChange={(nextValue) => {
                    const nextMode = nextValue[0];
                    if (
                      nextMode === "source-only" ||
                      nextMode === "alternating"
                    ) {
                      setModeChosen(true);
                      setMode(nextMode);
                    }
                  }}
                  size="sm"
                  value={[mode]}
                  variant="outline"
                >
                  <ToggleGroupItem value="source-only">
                    Source only
                  </ToggleGroupItem>
                  <ToggleGroupItem value="alternating">
                    Alternating source and reference
                  </ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  {prepared.lines.length}{" "}
                  {prepared.lines.length === 1 ? "entry" : "entries"}
                  {mode === "alternating"
                    ? " previewed as source/reference pairs."
                    : " previewed as source lines."}
                  {prepared.hasUnpairedLine
                    ? " The final source line has no reference yet."
                    : ""}
                  <span className="workspace__suggestion">
                    Suggested {suggestion.mode.replace("-", " ")} (
                    {suggestion.confidence}): {suggestion.reason}
                  </span>
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel>Source language</FieldLabel>
                <ToggleGroup
                  aria-label="Language for pasted source"
                  onValueChange={(nextValue) => {
                    const nextLanguage = nextValue[0];
                    if (nextLanguage === "ja" || nextLanguage === "zh") {
                      setSourceLanguage(nextLanguage);
                    }
                  }}
                  size="sm"
                  value={[sourceLanguage]}
                  variant="outline"
                >
                  <ToggleGroupItem value="ja">Japanese</ToggleGroupItem>
                  <ToggleGroupItem value="zh">Chinese</ToggleGroupItem>
                </ToggleGroup>
              </Field>

              <Field>
                <FieldLabel>Reference language</FieldLabel>
                <ToggleGroup
                  aria-label="Language for pasted reference"
                  onValueChange={(nextValue) => {
                    const nextLanguage = nextValue[0];
                    if (nextLanguage === "en" || nextLanguage === "vi") {
                      setReferenceLanguage(nextLanguage);
                    }
                  }}
                  size="sm"
                  value={[referenceLanguage]}
                  variant="outline"
                >
                  <ToggleGroupItem value="en">English</ToggleGroupItem>
                  <ToggleGroupItem value="vi">Vietnamese</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            </FieldGroup>

            {storageMessage ? (
              <p
                className={cn(
                  "workspace__storage-message",
                  `workspace__storage-message--${storageMessage.tone}`,
                )}
                role={storageMessage.tone === "error" ? "alert" : "status"}
              >
                {storageMessage.text}
              </p>
            ) : null}

            {storageRecovery ? (
              <Button
                onClick={
                  storageRecovery === "retry"
                    ? onRetryStorage
                    : onClearUnreadable
                }
                variant="outline"
              >
                {storageRecovery === "clear"
                  ? "Clear unreadable local data"
                  : storageRecovery === "retry-clear"
                    ? "Retry clearing local data"
                    : "Try local storage again"}
              </Button>
            ) : null}

            <Button onClick={handleReviewPairs} size="lg">
              <BookOpenText data-icon="inline-start" aria-hidden="true" />
              Review and correct pairs
            </Button>
            <Button onClick={onUploadSubtitleFiles} size="lg" variant="outline">
              <FileUp data-icon="inline-start" aria-hidden="true" />
              Upload subtitle files
            </Button>
            {onResumeSubtitleDraft ? (
              <Button onClick={onResumeSubtitleDraft} variant="ghost">
                Resume subtitle draft
              </Button>
            ) : null}
          </EmptyContent>
        </Empty>
      </main>
    </div>
  );
}

function ReviewSurface({
  onProgrammaticScrollEnd,
  onRetryClear,
  onRetryStorage,
  session,
  storageMessage,
  storageRecovery,
  onActiveLineChange,
  registerLine,
  onScroll,
  onUserScrollIntent,
  showSpeakerNames,
}: {
  onProgrammaticScrollEnd: () => void;
  onRetryClear: () => void;
  onRetryStorage: () => void;
  session: ReviewSession;
  storageMessage: StorageMessage;
  storageRecovery: StorageRecovery;
  onActiveLineChange: (lineId: string, shouldScroll: boolean) => void;
  registerLine: (lineId: string) => RefCallback<HTMLElement>;
  onScroll: () => void;
  onUserScrollIntent: () => void;
  showSpeakerNames: boolean;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(
        'button, input, textarea, select, [contenteditable="true"]',
      )
    ) {
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const currentIndex = session.lines.findIndex(
      (line) => line.id === session.activeLineId,
    );
    const nextIndex =
      event.key === "ArrowDown" ? currentIndex + 1 : currentIndex - 1;
    const nextLine = session.lines[nextIndex];

    if (!nextLine) {
      return;
    }

    event.preventDefault();
    onActiveLineChange(nextLine.id, true);
  }

  return (
    <section
      aria-label="Continuous dialogue review"
      className="workspace__review-surface"
      onKeyDown={handleKeyDown}
      onScroll={onScroll}
      onScrollEnd={onProgrammaticScrollEnd}
      onTouchStart={onUserScrollIntent}
      onWheel={onUserScrollIntent}
      tabIndex={0}
    >
      <div className="workspace__review-intro">
        <p className="workspace__eyebrow">Continuous review</p>
        <h1>
          {session.lines.length} local dialogue{" "}
          {session.lines.length === 1 ? "entry" : "entries"}
        </h1>
        <p>
          Select a line, or use the arrow keys while this surface is focused.
        </p>
        {storageMessage ? (
          <div className="workspace__review-storage">
            <p
              className={cn(
                "workspace__storage-message",
                `workspace__storage-message--${storageMessage.tone}`,
              )}
              role={storageMessage.tone === "error" ? "alert" : "status"}
            >
              {storageMessage.text}
            </p>
            {storageMessage.tone === "error" && storageRecovery ? (
              <Button
                onClick={
                  storageRecovery === "retry-clear"
                    ? onRetryClear
                    : onRetryStorage
                }
                size="sm"
                variant="outline"
              >
                {storageRecovery === "retry-clear"
                  ? "Retry clearing local session"
                  : "Try local storage again"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="workspace__line-list">
        {session.lines.map((line, index) => {
          const active = line.id === session.activeLineId;

          return (
            <article
              aria-current={active ? "true" : undefined}
              className={cn(
                "workspace__line",
                active && "workspace__line--active",
              )}
              data-line-id={line.id}
              key={line.id}
              onClick={() => onActiveLineChange(line.id, false)}
              ref={registerLine(line.id)}
            >
              <div className="workspace__line-meta">
                <span>Line {index + 1}</span>
                {showSpeakerNames && line.subtitle?.speakers.length ? (
                  <span className="workspace__speaker">
                    {line.subtitle.speakers.join(" · ")}
                  </span>
                ) : null}
                {active ? <Badge>Active</Badge> : null}
              </div>
              <div className="workspace__line-text">
                <p lang={session.sourceLanguage}>
                  <span className="workspace__language-label">
                    {sourceLanguageLabels[session.sourceLanguage]}
                  </span>
                  {line.source || "Blank source line"}
                </p>
                {line.reference !== undefined ? (
                  <p lang={session.referenceLanguage}>
                    <span className="workspace__language-label">
                      {referenceLanguageLabels[session.referenceLanguage]}
                    </span>
                    {line.reference || "Blank reference line"}
                  </p>
                ) : null}
              </div>
              {active ? (
                <div className="workspace__line-active-note">
                  <span>Unprocessed source span</span>
                  <Button
                    aria-label={`Inspect unprocessed source span: ${linePreview(line)}`}
                    aria-pressed="true"
                    className="workspace__raw-span"
                    size="sm"
                    variant="outline"
                  >
                    {line.source || "Blank source line"}
                  </Button>
                  <span>
                    Local token evidence is unavailable until language assets
                    are installed.
                  </span>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ReviewWorkspace({
  clearing,
  onClear,
  onEvidencePanelWidth,
  onRetryClear,
  onRetryStorage,
  onSelectLine,
  session,
  storageMessage,
  storageRecovery,
  onReviewAlignment,
  showSpeakerNames,
}: {
  clearing: boolean;
  onClear: () => void;
  onEvidencePanelWidth: (width: number) => void;
  onRetryClear: () => void;
  onRetryStorage: () => void;
  onSelectLine: (lineId: string, shouldScroll: boolean) => void;
  session: ReviewSession;
  storageMessage: StorageMessage;
  storageRecovery: StorageRecovery;
  onReviewAlignment?: () => void;
  showSpeakerNames: boolean;
}) {
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const lineElements = useRef(new Map<string, HTMLElement>());
  const desktopPanels = useRef<HTMLDivElement>(null);
  const navigatorElements = useRef(new Map<string, HTMLButtonElement>());
  const mobileNavigatorElements = useRef(new Map<string, HTMLButtonElement>());
  const programmaticScrollTarget = useRef<string | null>(null);
  const programmaticScrollTimeout = useRef<number | null>(null);

  function registerLine(lineId: string): RefCallback<HTMLElement> {
    return (element) => {
      if (element) {
        lineElements.current.set(lineId, element);
      } else {
        lineElements.current.delete(lineId);
      }
    };
  }

  function registerNavigatorLine(
    elements: React.RefObject<Map<string, HTMLButtonElement>>,
    lineId: string,
  ): RefCallback<HTMLButtonElement> {
    return (element) => {
      if (element) {
        elements.current.set(lineId, element);
      } else {
        elements.current.delete(lineId);
      }
    };
  }

  useEffect(() => {
    if (!session.activeLineId) {
      return;
    }

    for (const elements of [navigatorElements, mobileNavigatorElements]) {
      const element = elements.current.get(session.activeLineId);
      if (element?.offsetParent) {
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
  }, [session.activeLineId]);

  useEffect(
    () => () => {
      if (programmaticScrollTimeout.current !== null) {
        window.clearTimeout(programmaticScrollTimeout.current);
      }
    },
    [],
  );

  function clearProgrammaticScrollTarget() {
    programmaticScrollTarget.current = null;
    if (programmaticScrollTimeout.current !== null) {
      window.clearTimeout(programmaticScrollTimeout.current);
      programmaticScrollTimeout.current = null;
    }
  }

  function closestReviewLine() {
    return [...lineElements.current.entries()]
      .map(([lineId, element]) => ({
        lineId,
        distance: Math.abs(element.getBoundingClientRect().top - 108),
      }))
      .sort((first, second) => first.distance - second.distance)[0];
  }

  function handleScroll() {
    const candidate = closestReviewLine();

    if (programmaticScrollTarget.current) {
      return;
    }

    if (candidate && candidate.lineId !== session.activeLineId) {
      onSelectLine(candidate.lineId, false);
    }
  }

  function handleLineChange(lineId: string, shouldScroll: boolean) {
    onSelectLine(lineId, shouldScroll);

    if (shouldScroll) {
      clearProgrammaticScrollTarget();
      const lineElement = lineElements.current.get(lineId);
      if (lineElement) {
        programmaticScrollTarget.current = lineId;
        programmaticScrollTimeout.current = window.setTimeout(
          clearProgrammaticScrollTarget,
          2_000,
        );
        lineElement.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
          block: "center",
        });
      }
    }
  }

  return (
    <div className="workspace">
      <header className="workspace__header">
        <Link className="workspace__brand" href="/" aria-label="moyu home">
          moyu
        </Link>
        <div className="workspace__header-status">
          <Badge variant="outline">Local session</Badge>
          {onReviewAlignment ? (
            <Button onClick={onReviewAlignment} size="sm" variant="ghost">
              Review alignment
            </Button>
          ) : null}
          <Link className="workspace__account-link" href="/account">
            Account
          </Link>
          <AlertDialog onOpenChange={setClearDialogOpen} open={clearDialogOpen}>
            <AlertDialogTrigger render={<Button size="sm" variant="ghost" />}>
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              Clear session
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Clear this local review session?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This removes dialogue and local analysis from this browser
                  only. Your account, phrases, tags, and settings remain
                  available.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep session</AlertDialogCancel>
                <AlertDialogAction
                  disabled={clearing}
                  onClick={() => {
                    setClearDialogOpen(false);
                    onClear();
                  }}
                  variant="destructive"
                >
                  {clearing ? "Clearing…" : "Clear local session"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <nav
        aria-label="Dialogue position"
        className="workspace__mobile-navigator"
      >
        <div className="workspace__mobile-navigator-track">
          {session.lines.map((line, index) => (
            <Button
              aria-current={
                line.id === session.activeLineId ? "true" : undefined
              }
              key={line.id}
              onClick={() => handleLineChange(line.id, true)}
              ref={registerNavigatorLine(mobileNavigatorElements, line.id)}
              size="sm"
              variant="ghost"
            >
              <span>{index + 1}</span>
              <span>{linePreview(line)}</span>
            </Button>
          ))}
        </div>
      </nav>

      <div className="workspace__desktop" ref={desktopPanels}>
        <ResizablePanelGroup
          className="workspace__panels"
          onLayoutChanged={(layout, metadata) => {
            const containerWidth = desktopPanels.current?.clientWidth;
            if (
              metadata.isUserInteraction &&
              layout.evidence !== undefined &&
              containerWidth
            ) {
              onEvidencePanelWidth(
                Math.min(
                  720,
                  Math.max(280, (layout.evidence / 100) * containerWidth),
                ),
              );
            }
          }}
          orientation="horizontal"
        >
          <ResizablePanel
            className="workspace__navigator-panel"
            defaultSize="22%"
            id="navigator"
            minSize="16%"
          >
            <nav
              className="workspace__navigator"
              aria-label="Dialogue navigator"
            >
              <div className="workspace__panel-title">
                <p className="workspace__eyebrow">Navigator</p>
                <span>{session.lines.length} lines</span>
              </div>
              <ScrollArea className="workspace__navigator-scroll">
                <div className="workspace__navigator-list">
                  {session.lines.map((line, index) => (
                    <Button
                      aria-current={
                        line.id === session.activeLineId ? "true" : undefined
                      }
                      className="workspace__navigator-item"
                      key={line.id}
                      onClick={() => handleLineChange(line.id, true)}
                      ref={registerNavigatorLine(navigatorElements, line.id)}
                      size="sm"
                      variant="ghost"
                    >
                      <span>{index + 1}</span>
                      <span>{linePreview(line)}</span>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </nav>
          </ResizablePanel>
          <ResizableHandle className="workspace__divider" withHandle />
          <ResizablePanel
            className="workspace__review-panel"
            id="review"
            minSize="35%"
          >
            <ReviewSurface
              onActiveLineChange={handleLineChange}
              onProgrammaticScrollEnd={clearProgrammaticScrollTarget}
              onRetryClear={onRetryClear}
              onRetryStorage={onRetryStorage}
              onScroll={handleScroll}
              onUserScrollIntent={clearProgrammaticScrollTarget}
              registerLine={registerLine}
              session={session}
              storageMessage={storageMessage}
              storageRecovery={storageRecovery}
              showSpeakerNames={showSpeakerNames}
            />
          </ResizablePanel>
          <ResizableHandle className="workspace__divider" withHandle />
          <ResizablePanel
            className="workspace__evidence-panel"
            defaultSize={`${session.evidencePanelWidth}px`}
            id="evidence"
            maxSize="720px"
            minSize="280px"
          >
            <EvidencePane session={session} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <div className="workspace__mobile-evidence">
        <Sheet>
          <SheetTrigger
            render={
              <Button
                className="workspace__mobile-evidence-trigger"
                variant="outline"
              />
            }
          >
            <PanelRight data-icon="inline-start" aria-hidden="true" />
            Evidence
          </SheetTrigger>
          <SheetContent className="workspace__evidence-sheet" side="bottom">
            <SheetHeader>
              <SheetTitle>Evidence</SheetTitle>
              <SheetDescription>
                Local evidence for the active dialogue line.
              </SheetDescription>
            </SheetHeader>
            <EvidencePane session={session} />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

const emptyWorkspaceSnapshot: LocalWorkspaceSnapshot = {
  session: null,
  subtitleImport: null,
  artifacts: [],
  preferences: { showSpeakerNames: true },
};

export function LocalReviewWorkspace() {
  const [result, setResult] = useState<LocalWorkspaceResult | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void createLocalSessionStore(window.indexedDB)
      .load()
      .then((loaded) => {
        if (active) setResult(loaded);
      });
    return () => {
      active = false;
    };
  }, [loadRevision]);

  if (!result)
    return <main className="workspace__loading">Opening local review…</main>;
  return (
    <HydratedLocalReviewWorkspace
      key={loadRevision}
      initialSnapshot={
        result.kind === "available" ? result.snapshot : emptyWorkspaceSnapshot
      }
      initialMessage={
        result.kind === "unavailable" || result.kind === "corrupt"
          ? { tone: "error", text: result.reason }
          : null
      }
      initialRecovery={
        result.kind === "corrupt"
          ? "clear"
          : result.kind === "unavailable"
            ? "retry"
            : null
      }
      onReloadStorage={() => {
        setResult(null);
        setLoadRevision((revision) => revision + 1);
      }}
    />
  );
}

function HydratedLocalReviewWorkspace({
  initialSnapshot,
  initialMessage,
  initialRecovery,
  onReloadStorage,
}: {
  initialSnapshot: LocalWorkspaceSnapshot;
  initialMessage: StorageMessage;
  initialRecovery: StorageRecovery;
  onReloadStorage: () => void;
}) {
  const [clearing, setClearing] = useState(false);
  const [session, setSession] = useState<ReviewSession | null>(
    initialSnapshot.session,
  );
  const [viewMode, setViewMode] = useState<"review" | "alignment">("review");
  const [storageRecovery, setStorageRecovery] =
    useState<StorageRecovery>(initialRecovery);
  const [storageMessage, setStorageMessage] =
    useState<StorageMessage>(initialMessage);
  const [persistence] = useState<WorkspacePersistenceQueue>(() =>
    createWorkspacePersistenceQueue(() =>
      createLocalSessionStore(window.indexedDB),
    ),
  );
  const clearUnreadableRef = useRef(false);
  const subtitleController = useSubtitleImport({
    initialImport: initialSnapshot.subtitleImport,
    initialArtifacts: initialSnapshot.artifacts,
    initialPreferences: initialSnapshot.preferences,
    hasReviewSession: initialSnapshot.session !== null,
    persistence,
    getEvidencePanelWidth: () => session?.evidencePanelWidth ?? 360,
    onCleared: () => {
      setSession(null);
      setViewMode("alignment");
      setStorageRecovery(null);
    },
  });

  function persistSession(nextSession: ReviewSession, beginSession = false) {
    if (clearing) {
      return;
    }

    if (beginSession) {
      persistence.beginReviewContent();
    }

    setSession(nextSession);
    setViewMode("review");
    void persistence.saveSession(nextSession).then((result) => {
      if (result.kind === "ignored") {
        return;
      }

      if (result.kind === "unavailable") {
        setStorageMessage({ tone: "error", text: result.reason });
        setStorageRecovery("retry");
      } else {
        setStorageMessage(
          beginSession
            ? { tone: "success", text: "Saved in this browser." }
            : null,
        );
        setStorageRecovery(null);
      }
    });
  }

  function handleSelectLine(lineId: string, shouldScroll: boolean) {
    if (clearing || !session || lineId === session.activeLineId) {
      return;
    }

    persistSession({ ...session, activeLineId: lineId });

    if (shouldScroll) {
      return;
    }
  }

  function handleEvidencePanelWidth(evidencePanelWidth: number) {
    if (
      clearing ||
      !session ||
      Math.abs(session.evidencePanelWidth - evidencePanelWidth) < 0.5
    ) {
      return;
    }

    persistSession({ ...session, evidencePanelWidth });
  }

  function handleClear(unreadable = false) {
    if (clearing) {
      return;
    }

    clearUnreadableRef.current = unreadable || clearUnreadableRef.current;
    setClearing(true);
    void persistence.clearReviewContent().then((result) => {
      setStorageMessage(
        result.kind === "unavailable"
          ? { tone: "error", text: result.reason }
          : {
              tone: "success",
              text: clearUnreadableRef.current
                ? "Unreadable local data was cleared."
                : "The local review session was cleared.",
            },
      );

      if (result.kind === "saved") {
        subtitleController.resetAfterClear();
        setSession(null);
        setStorageRecovery(null);
        clearUnreadableRef.current = false;
      } else {
        setStorageRecovery("retry-clear");
      }
      setClearing(false);
    });
  }

  function handleRetryStorage() {
    if (session) {
      void persistence.saveSession(session).then((result) => {
        if (result.kind === "ignored") {
          return;
        }
        if (result.kind === "unavailable") {
          setStorageMessage({ tone: "error", text: result.reason });
          setStorageRecovery("retry");
        } else {
          setStorageMessage({
            tone: "success",
            text: "Saved in this browser.",
          });
          setStorageRecovery(null);
        }
      });
      return;
    }

    onReloadStorage();
  }

  function openSavedAlignment() {
    subtitleController.openAlignment();
    setViewMode("alignment");
  }

  const importState =
    subtitleController.state.kind === "idle"
      ? subtitleController.state.restoredImport
      : subtitleController.state.importState;
  const draft = importState?.draft;
  const canReopen =
    session?.origin.kind === "subtitle" &&
    session.origin.importId === importState?.id &&
    Boolean(draft);
  let surface;
  if (session && viewMode === "review") {
    surface = (
      <ReviewWorkspace
        clearing={clearing}
        onClear={() => handleClear(false)}
        onEvidencePanelWidth={handleEvidencePanelWidth}
        onRetryClear={() => handleClear(clearUnreadableRef.current)}
        onRetryStorage={handleRetryStorage}
        onSelectLine={handleSelectLine}
        session={session}
        storageMessage={storageMessage}
        storageRecovery={storageRecovery}
        showSpeakerNames={subtitleController.showSpeakerNames}
        onReviewAlignment={canReopen ? openSavedAlignment : undefined}
      />
    );
  } else if (draft && subtitleController.state.kind !== "idle") {
    surface = (
      <SubtitleAlignmentWorkspace
        controller={subtitleController}
        draft={draft}
        onBackToReview={session ? () => setViewMode("review") : undefined}
        onStartReview={async () => {
          const result = await subtitleController.startReview();
          if (result.kind === "started") {
            setSession(result.session);
            setViewMode("review");
            setStorageMessage(null);
            setStorageRecovery(null);
          }
        }}
      />
    );
  } else {
    surface = (
      <ImportDesk
        onClearUnreadable={() => handleClear(true)}
        onImport={(nextSession) => persistSession(nextSession, true)}
        onRetryStorage={handleRetryStorage}
        storageMessage={storageMessage ?? subtitleController.notice}
        storageRecovery={storageRecovery}
        onUploadSubtitleFiles={subtitleController.openFiles}
        onResumeSubtitleDraft={draft ? openSavedAlignment : undefined}
      />
    );
  }
  return (
    <>
      {surface}
      <SubtitleFileDialog controller={subtitleController} />
    </>
  );
}

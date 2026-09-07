"use client";

import Link from "next/link";
import { BookOpenText, FileText, PanelRight, Save } from "lucide-react";
import { useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type {
  AlignmentGroup,
  SubtitleCue,
  SubtitleImportDraft,
} from "./subtitles/contracts";
import {
  acceptAlignmentGroup,
  attachReferences,
  detachReferences,
  ignoreReference,
  isSubtitleDraftReady,
  keepSourceOnly,
  splitSourceGroup,
} from "./subtitles/draft";
import type { SubtitleImportController } from "./use-subtitle-import";

function timestamp(ms: number | null) {
  if (ms === null) return "Unknown time";
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(
      2,
      "0",
    )}:${(seconds % 60).toString().padStart(2, "0")}.${(ms % 1_000).toString().padStart(3, "0")}`;
}

function timing(cue: SubtitleCue) {
  return `${timestamp(cue.startMs)} – ${timestamp(cue.endMs)}`;
}

function groupStatus(group: AlignmentGroup) {
  if (group.decision === "source-only") return "Source-only confirmed";
  if (group.decision === "accepted") return "Accepted grouping";
  if (group.status === "confident") return "Confident match";
  return group.status === "source-only" ? "No reference" : "Check alignment";
}

function CueText({
  cue,
  language,
  showSpeakerNames,
}: {
  cue: SubtitleCue;
  language: string;
  showSpeakerNames: boolean;
}) {
  return (
    <div className="workspace__subtitle-cue">
      <div className="workspace__cue-meta">
        <span>{timing(cue)}</span>
        {showSpeakerNames && cue.speaker ? (
          <span className="workspace__speaker">{cue.speaker}</span>
        ) : null}
      </div>
      <p lang={language}>{cue.visibleText || "Blank cue"}</p>
      {cue.warnings.map((warning, index) => (
        <p className="workspace__cue-warning" key={`${warning.code}-${index}`}>
          {warning.message}
        </p>
      ))}
    </div>
  );
}

function AlignmentRow({
  controller,
  draft,
  group,
  index,
  onChooseNearby,
  register,
}: {
  controller: SubtitleImportController;
  draft: SubtitleImportDraft;
  group: AlignmentGroup;
  index: number;
  onChooseNearby: (groupId: string) => void;
  register: (element: HTMLElement | null) => void;
}) {
  const source = draft.sourceCues.filter((cue) =>
    group.sourceCueIds.includes(cue.id),
  );
  const reference = draft.referenceCues.filter((cue) =>
    group.referenceCueIds.includes(cue.id),
  );
  return (
    <article
      aria-label={`Alignment group ${index + 1}`}
      aria-current={draft.activeGroupId === group.id ? "true" : undefined}
      className="workspace__alignment-row"
      data-decision={group.decision}
      ref={register}
      tabIndex={-1}
    >
      <header className="workspace__alignment-row-heading">
        <h2>Group {index + 1}</h2>
        <Badge variant={group.decision === "pending" ? "outline" : "secondary"}>
          {groupStatus(group)}
        </Badge>
      </header>
      <p className="workspace__group-summary">
        {source.length} source {source.length === 1 ? "cue" : "cues"} ·{" "}
        {reference.length} reference {reference.length === 1 ? "cue" : "cues"}
        {group.confidence !== null
          ? ` · ${group.confidence}% timing confidence`
          : ""}
      </p>
      <div className="workspace__alignment-text">
        <div>
          <h3>Source</h3>
          {source.map((cue) => (
            <CueText
              key={cue.id}
              cue={cue}
              language={draft.sourceLanguage}
              showSpeakerNames={controller.showSpeakerNames}
            />
          ))}
        </div>
        <div>
          <h3>Reference</h3>
          {reference.length === 0 ? (
            <p className="workspace__muted">No reference attached.</p>
          ) : null}
          {reference.map((cue) => (
            <div className="workspace__attached-reference" key={cue.id}>
              <CueText
                cue={cue}
                language={draft.referenceLanguage}
                showSpeakerNames={controller.showSpeakerNames}
              />
              <Button
                aria-label={`Detach reference cue ${cue.sourceOrder + 1}`}
                onClick={() =>
                  controller.updateDraft((current) =>
                    detachReferences(current, group.id, [cue.id]),
                  )
                }
                size="sm"
                variant="ghost"
              >
                Detach reference
              </Button>
            </div>
          ))}
        </div>
      </div>
      <div className="workspace__correction-actions">
        {reference.length > 0 ? (
          <Button
            disabled={group.decision === "accepted"}
            onClick={() =>
              controller.updateDraft((current) =>
                acceptAlignmentGroup(current, group.id),
              )
            }
            size="sm"
            variant="outline"
          >
            Accept grouping
          </Button>
        ) : null}
        {source.length > 1 ? (
          <Button
            onClick={() =>
              controller.updateDraft((current) =>
                splitSourceGroup(current, group.id),
              )
            }
            size="sm"
            variant="outline"
          >
            Split source
          </Button>
        ) : null}
        <Button
          disabled={draft.unassignedReferenceCueIds.length === 0}
          onClick={() => onChooseNearby(group.id)}
          size="sm"
          variant="outline"
        >
          Choose nearby cue
        </Button>
        <Button
          disabled={group.decision === "source-only"}
          onClick={() =>
            controller.updateDraft((current) =>
              keepSourceOnly(current, group.id),
            )
          }
          size="sm"
          variant="ghost"
        >
          Keep source-only
        </Button>
      </div>
    </article>
  );
}

function ReferenceTray({
  controller,
  draft,
  idSuffix,
}: {
  controller: SubtitleImportController;
  draft: SubtitleImportDraft;
  idSuffix: string;
}) {
  const reference = draft.referenceCues.filter((cue) =>
    draft.unassignedReferenceCueIds.includes(cue.id),
  );
  const activeIndex = draft.groups.findIndex(
    (group) => group.id === draft.activeGroupId,
  );
  return (
    <>
      <div className="workspace__tray-heading">
        <h2>UNASSIGNED · {reference.length}</h2>
        <p className="workspace__muted">
          {reference.length} to resolve · attaching to group {activeIndex + 1}
        </p>
        <Field orientation="horizontal">
          <Checkbox
            nativeButton
            render={<button type="button" />}
            checked={controller.showSpeakerNames}
            id={`show-speaker-names-${idSuffix}`}
            onCheckedChange={(checked) =>
              controller.setShowSpeakerNames(checked)
            }
          />
          <FieldLabel htmlFor={`show-speaker-names-${idSuffix}`}>
            Show speaker names
          </FieldLabel>
        </Field>
      </div>
      <Separator />
      <ScrollArea className="workspace__tray-scroll">
        <div className="workspace__tray-list">
          {reference.length === 0 ? (
            <p className="workspace__muted">No unassigned reference cues.</p>
          ) : null}
          {reference.map((cue) => (
            <section
              aria-label={`Unassigned reference cue ${cue.sourceOrder + 1}`}
              className="workspace__reference-cue"
              key={cue.id}
            >
              <h3>Reference cue {cue.sourceOrder + 1}</h3>
              <CueText
                cue={cue}
                language={draft.referenceLanguage}
                showSpeakerNames={controller.showSpeakerNames}
              />
              <div className="workspace__correction-actions">
                <Button
                  aria-label={`Attach reference cue ${cue.sourceOrder + 1} to active group`}
                  disabled={draft.activeGroupId === null}
                  onClick={() =>
                    controller.updateDraft((current) =>
                      current.activeGroupId
                        ? attachReferences(current, current.activeGroupId, [
                            cue.id,
                          ])
                        : current,
                    )
                  }
                  size="sm"
                  variant="outline"
                >
                  Use this match
                </Button>
                <Button
                  aria-label={`Ignore reference cue ${cue.sourceOrder + 1}`}
                  onClick={() =>
                    controller.updateDraft((current) =>
                      ignoreReference(current, cue.id),
                    )
                  }
                  size="sm"
                  variant="ghost"
                >
                  Ignore reference cue {cue.sourceOrder + 1}
                </Button>
              </div>
            </section>
          ))}
          {draft.ignoredReferenceCueIds.length > 0 ? (
            <p className="workspace__muted">
              {draft.ignoredReferenceCueIds.length} reference{" "}
              {draft.ignoredReferenceCueIds.length === 1 ? "cue" : "cues"}{" "}
              explicitly ignored.
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </>
  );
}

export function SubtitleAlignmentWorkspace({
  controller,
  draft,
  onStartReview,
  onBackToReview,
}: {
  controller: SubtitleImportController;
  draft: SubtitleImportDraft;
  onStartReview: () => Promise<void>;
  onBackToReview?: () => void;
}) {
  const [nearbyGroupId, setNearbyGroupId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const rows = useRef(new Map<string, HTMLElement>());
  const importState =
    controller.state.kind === "idle"
      ? controller.state.restoredImport
      : controller.state.importState;
  const configurationMatchesDraft =
    importState?.source.artifactId === draft.sourceArtifactId &&
    importState?.reference?.artifactId === draft.referenceArtifactId &&
    importState?.source.language === draft.sourceLanguage &&
    (!importState.reference ||
      importState.reference.language === draft.referenceLanguage);
  const ready =
    isSubtitleDraftReady(draft) &&
    !importState?.failure &&
    configurationMatchesDraft;
  const sourceFile = controller.artifactById(draft.sourceArtifactId);
  const activeGroupIndex = draft.groups.findIndex(
    (group) => group.id === draft.activeGroupId,
  );
  const referenceFile = draft.referenceArtifactId
    ? controller.artifactById(draft.referenceArtifactId)
    : null;
  const nearbyGroup = draft.groups.find((group) => group.id === nearbyGroupId);
  const nearbySource = draft.sourceCues.find(
    (cue) => cue.id === nearbyGroup?.sourceCueIds[0],
  );
  const nearby = draft.referenceCues
    .filter((cue) => draft.unassignedReferenceCueIds.includes(cue.id))
    .sort((left, right) => {
      const distance = (cue: SubtitleCue) =>
        cue.startMs === null || nearbySource?.startMs == null
          ? Number.MAX_SAFE_INTEGER
          : Math.abs(cue.startMs - nearbySource.startMs);
      return (
        distance(left) - distance(right) || left.sourceOrder - right.sourceOrder
      );
    });

  function selectGroup(groupId: string) {
    controller.updateDraft((current) => ({
      ...current,
      activeGroupId: groupId,
    }));
    rows.current
      .get(groupId)
      ?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }

  return (
    <div className="workspace__alignment">
      <header className="workspace__header">
        <Link className="workspace__brand" href="/" aria-label="moyu home">
          moyu
        </Link>
        <div className="workspace__alignment-context">
          <span>{sourceFile?.name ?? "Source subtitles"}</span>
          <span>{referenceFile?.name ?? "No reference file"}</span>
        </div>
        <Badge className="workspace__alignment-local" variant="outline">
          Local only
        </Badge>
        <Button onClick={controller.openFiles} variant="outline">
          <FileText data-icon="inline-start" aria-hidden="true" />
          Files &amp; encoding
        </Button>
      </header>
      <div className="workspace__alignment-shell">
        <nav
          aria-label="Subtitle cue navigator"
          className="workspace__cue-navigator"
        >
          <div className="workspace__panel-title">
            <h2>
              CUES · {activeGroupIndex + 1}/{draft.groups.length}
            </h2>
          </div>
          <ScrollArea className="workspace__cue-navigator-scroll">
            <div className="workspace__cue-navigator-list">
              {draft.groups.map((group, index) => {
                const source = draft.sourceCues.find(
                  (cue) => cue.id === group.sourceCueIds[0],
                );
                return (
                  <Button
                    aria-current={
                      draft.activeGroupId === group.id ? "true" : undefined
                    }
                    className="workspace__cue-nav-button"
                    key={group.id}
                    onClick={() => selectGroup(group.id)}
                    variant="ghost"
                  >
                    <span>{`Cue ${source ? source.sourceOrder + 1 : index + 1} · ${source?.visibleText || "Blank cue"}`}</span>
                    <span>{groupStatus(group)}</span>
                  </Button>
                );
              })}
            </div>
          </ScrollArea>
        </nav>
        <main
          aria-label="Subtitle alignment"
          className="workspace__alignment-main"
        >
          <div className="workspace__alignment-intro">
            <h1>PAIRED LINES</h1>
            <p className="workspace__muted">
              {draft.sourceCues.length} source cues ·{" "}
              {draft.referenceCues.length} reference cues ·{" "}
              {draft.sourceLanguage.toUpperCase()} →{" "}
              {draft.referenceLanguage.toUpperCase()}
            </p>
          </div>
          {draft.blockingFailures.map((failure, index) => (
            <Alert key={index} variant="destructive">
              <AlertTitle>Resolve subtitle processing</AlertTitle>
              <AlertDescription>{failure.message}</AlertDescription>
            </Alert>
          ))}
          {importState?.failure ? (
            <Alert variant="destructive">
              <AlertTitle>Replacement needs attention</AlertTitle>
              <AlertDescription>
                Open Files &amp; encoding to retry or keep the previous parsed
                file.
              </AlertDescription>
            </Alert>
          ) : null}
          {!configurationMatchesDraft && !importState?.failure ? (
            <Alert>
              <AlertTitle>File settings changed</AlertTitle>
              <AlertDescription>
                Open Files &amp; encoding and choose Re-align files to apply
                your selected files, languages, and encodings before starting
                review.
              </AlertDescription>
            </Alert>
          ) : null}
          {controller.notice ? (
            <Alert
              role={controller.notice.tone === "error" ? "alert" : "status"}
              variant={
                controller.notice.tone === "error" ? "destructive" : "default"
              }
            >
              <AlertDescription>{controller.notice.text}</AlertDescription>
            </Alert>
          ) : null}
          <div className="workspace__alignment-rows">
            {draft.groups.map((group, index) => (
              <AlignmentRow
                key={group.id}
                controller={controller}
                draft={draft}
                group={group}
                index={index}
                onChooseNearby={setNearbyGroupId}
                register={(element) => {
                  if (element) rows.current.set(group.id, element);
                  else rows.current.delete(group.id);
                }}
              />
            ))}
          </div>
        </main>
        <aside
          aria-label="Unassigned references"
          className="workspace__reference-tray"
        >
          <ReferenceTray
            controller={controller}
            draft={draft}
            idSuffix="desktop"
          />
        </aside>
      </div>
      <footer className="workspace__alignment-actions">
        <Button
          onClick={onBackToReview ?? controller.backToPaste}
          variant="ghost"
        >
          {onBackToReview ? "Back to review" : "Back to paste"}
        </Button>
        <div className="workspace__alignment-mobile-tray">
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>
              <PanelRight data-icon="inline-start" aria-hidden="true" />
              Unassigned references ({draft.unassignedReferenceCueIds.length})
            </SheetTrigger>
            <SheetContent className="workspace__reference-sheet" side="bottom">
              <SheetHeader>
                <SheetTitle>Unassigned references</SheetTitle>
                <SheetDescription>
                  Attach to the active source group or explicitly ignore each
                  reference.
                </SheetDescription>
              </SheetHeader>
              <ReferenceTray
                controller={controller}
                draft={draft}
                idSuffix="mobile"
              />
            </SheetContent>
          </Sheet>
        </div>
        <Button onClick={() => void controller.saveDraft()} variant="outline">
          <Save data-icon="inline-start" aria-hidden="true" />
          Save local draft
        </Button>
        <Button
          disabled={!ready || starting}
          onClick={async () => {
            setStarting(true);
            try {
              await onStartReview();
            } finally {
              setStarting(false);
            }
          }}
        >
          <BookOpenText data-icon="inline-start" aria-hidden="true" />
          Start local review
        </Button>
      </footer>
      <Dialog
        open={nearbyGroupId !== null}
        onOpenChange={(open) => {
          if (!open) setNearbyGroupId(null);
        }}
      >
        <DialogContent className="workspace__nearby-dialog">
          <DialogHeader>
            <DialogTitle>Choose nearby cue</DialogTitle>
            <DialogDescription>
              Unassigned references ordered by start-time distance. Choose
              explicitly; timing does not imply meaning.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="workspace__nearby-scroll">
            <div className="workspace__tray-list">
              {nearby.map((cue) => (
                <section className="workspace__reference-cue" key={cue.id}>
                  <CueText
                    cue={cue}
                    language={draft.referenceLanguage}
                    showSpeakerNames={controller.showSpeakerNames}
                  />
                  <Button
                    aria-label={`Use reference cue ${cue.sourceOrder + 1} as match`}
                    onClick={() => {
                      if (nearbyGroupId)
                        controller.updateDraft((current) =>
                          attachReferences(current, nearbyGroupId, [cue.id]),
                        );
                      setNearbyGroupId(null);
                    }}
                    variant="outline"
                  >
                    Use this match
                  </Button>
                </section>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

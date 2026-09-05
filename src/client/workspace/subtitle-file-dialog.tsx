"use client";

import { FileText, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type {
  RequestedSubtitleEncoding,
  SubtitleFileRole,
} from "./subtitles/contracts";
import type { SubtitleImportController } from "./use-subtitle-import";

const encodings: readonly Readonly<{
  value: RequestedSubtitleEncoding;
  label: string;
}>[] = [
  { value: "utf-8", label: "UTF-8" },
  { value: "shift_jis", label: "Shift-JIS" },
  { value: "gb18030", label: "GB18030" },
  { value: "big5", label: "Big5" },
];

function FileSlot({
  controller,
  role,
}: {
  controller: SubtitleImportController;
  role: SubtitleFileRole;
}) {
  const source = role === "source";
  const artifact = controller.artifactForRole(role);
  const inputId = `${role}-subtitle-file`;
  const encodingId = `${role}-subtitle-encoding`;
  const error =
    controller.state.kind === "configuring"
      ? controller.state.errors.find((candidate) => candidate.role === role)
      : undefined;

  return (
    <section
      className="workspace__file-slot"
      aria-labelledby={`${role}-file-title`}
    >
      <div className="workspace__file-slot-heading">
        <div>
          <h3 id={`${role}-file-title`}>
            {source ? "Source subtitles" : "Reference subtitles"}
          </h3>
          <p>{source ? "Required" : "Optional"}</p>
        </div>
        <FileText aria-hidden="true" />
      </div>

      <FieldGroup>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={inputId}>
            {source ? "Source subtitle file" : "Reference subtitle file"}
          </FieldLabel>
          <Input
            accept=".srt,.ass"
            aria-describedby={`${inputId}-help`}
            aria-invalid={error ? true : undefined}
            disabled={controller.state.kind === "processing"}
            id={inputId}
            onChange={(event) =>
              controller.setFile(role, event.currentTarget.files?.[0] ?? null)
            }
            type="file"
          />
          <FieldDescription id={`${inputId}-help`}>
            {artifact
              ? `${artifact.name} · ${artifact.format.toUpperCase()} · local only`
              : source
                ? "Choose one .srt or .ass file, up to 25 MiB."
                : "Add one .srt or .ass translation file if available."}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor={`${role}-language`}>
            {source ? "Source language" : "Reference language"}
          </FieldLabel>
          <Select
            items={
              source
                ? [
                    { value: "ja", label: "Japanese" },
                    { value: "zh", label: "Chinese" },
                  ]
                : [
                    { value: "en", label: "English" },
                    { value: "vi", label: "Vietnamese" },
                  ]
            }
            disabled={controller.state.kind === "processing"}
            onValueChange={(value) => {
              if (source && (value === "ja" || value === "zh")) {
                controller.setSourceLanguage(value);
              } else if (!source && (value === "en" || value === "vi")) {
                controller.setReferenceLanguage(value);
              }
            }}
            value={
              source ? controller.sourceLanguage : controller.referenceLanguage
            }
          >
            <SelectTrigger
              aria-label={source ? "Source language" : "Reference language"}
              className="workspace__select"
              id={`${role}-language`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>
                  {source ? "Source language" : "Reference language"}
                </SelectLabel>
                {source ? (
                  <>
                    <SelectItem value="ja">Japanese</SelectItem>
                    <SelectItem value="zh">Chinese</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="vi">Vietnamese</SelectItem>
                  </>
                )}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor={encodingId}>
            {source ? "Source encoding" : "Reference encoding"}
          </FieldLabel>
          <Select
            items={encodings}
            disabled={controller.state.kind === "processing"}
            onValueChange={(value) => {
              if (
                value === "utf-8" ||
                value === "shift_jis" ||
                value === "gb18030" ||
                value === "big5"
              ) {
                controller.setEncoding(role, value);
              }
            }}
            value={
              source ? controller.sourceEncoding : controller.referenceEncoding
            }
          >
            <SelectTrigger
              aria-label={source ? "Source encoding" : "Reference encoding"}
              className="workspace__select"
              id={encodingId}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Text encoding</SelectLabel>
                {encodings.map((encoding) => (
                  <SelectItem key={encoding.value} value={encoding.value}>
                    {encoding.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
    </section>
  );
}

export function SubtitleFileDialog({
  controller,
}: {
  controller: SubtitleImportController;
}) {
  const [clearOpen, setClearOpen] = useState(false);
  const state = controller.state;
  const open =
    state.kind === "configuring" ||
    state.kind === "processing" ||
    state.kind === "error";
  const importState =
    state.kind === "idle" ? state.restoredImport : state.importState;
  const processing = state.kind === "processing";
  const hasDraft = Boolean(importState?.draft);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !processing) controller.closeFiles();
      }}
    >
      <DialogContent className="workspace__file-dialog">
        <DialogHeader>
          <DialogTitle>Subtitle files</DialogTitle>
          <DialogDescription>
            Parse one source file and an optional reference entirely in this
            browser. You will review every uncertain cue before starting.
          </DialogDescription>
        </DialogHeader>

        {state.kind === "error" ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>
              Could not parse {state.failure.role} subtitles
            </AlertTitle>
            <AlertDescription>
              <p>{state.failure.message}</p>
              {hasDraft ? (
                <Button
                  onClick={() =>
                    void controller.revertFailedReplacement(state.failure.role)
                  }
                  size="sm"
                  variant="outline"
                >
                  <RefreshCw data-icon="inline-start" aria-hidden="true" />
                  {state.failure.role === "reference" &&
                  !importState?.draft?.referenceArtifactId
                    ? "Keep source-only draft"
                    : "Keep previous parsed file"}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {state.kind === "configuring" && state.errors.length > 0 ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>Check the selected files</AlertTitle>
            <AlertDescription>
              {state.errors.map((error) => (
                <p key={`${error.role}-${error.message}`}>{error.message}</p>
              ))}
            </AlertDescription>
          </Alert>
        ) : null}

        {controller.notice?.tone === "error" ? (
          <Alert variant="destructive">
            <AlertTitle>Local storage needs attention</AlertTitle>
            <AlertDescription>{controller.notice.text}</AlertDescription>
          </Alert>
        ) : null}

        <div className="workspace__file-slots">
          <FileSlot controller={controller} role="source" />
          <FileSlot controller={controller} role="reference" />
        </div>

        <DialogFooter className="workspace__file-dialog-footer">
          <div className="workspace__file-dialog-secondary">
            <Button
              disabled={processing}
              onClick={controller.backToPaste}
              variant="ghost"
            >
              Use paste instead
            </Button>
            {importState ? (
              <AlertDialog onOpenChange={setClearOpen} open={clearOpen}>
                <AlertDialogTrigger
                  render={<Button disabled={processing} variant="ghost" />}
                >
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                  Clear local draft
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear this local draft?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the selected subtitle files, parsed cues, and
                      current local review content from this browser. Your
                      account settings remain.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep draft</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setClearOpen(false);
                        void controller.clearDraft();
                      }}
                      variant="destructive"
                    >
                      Clear local draft
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
          <Button
            disabled={processing}
            onClick={() => void controller.processFiles()}
          >
            {processing ? (
              <Spinner data-icon="inline-start" aria-hidden="true" />
            ) : (
              <FileText data-icon="inline-start" aria-hidden="true" />
            )}
            {processing
              ? "Parsing files…"
              : hasDraft
                ? "Re-align files"
                : "Parse files"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

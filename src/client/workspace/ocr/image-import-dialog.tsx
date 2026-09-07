"use client";

import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { prepareImport, type ImportMode } from "../import";
import type { ReferenceLanguage, ReviewSession } from "../model";
import type { WorkspacePersistenceQueue } from "../session-persistence";
import {
  createOcrImport,
  ocrLanguageSchema,
  reviewFromOcr,
  type OcrImport,
  type OcrLanguage,
} from "./contracts";
import { createOcrClient } from "./worker-client";

export function ImageImportDialog({
  open,
  onOpenChange,
  initialDraft,
  persistence,
  onImport,
  onClear,
  onDraftChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDraft: OcrImport | null;
  persistence: WorkspacePersistenceQueue;
  onImport: (session: ReviewSession) => void;
  onClear: () => void;
  onDraftChange: (draft: OcrImport) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(draft);
  const [language, setLanguage] = useState<OcrLanguage>(
    initialDraft?.language ?? "jpn",
  );
  const [mode, setMode] = useState<ImportMode>(
    initialDraft?.mode ?? "source-only",
  );
  const [referenceLanguage, setReferenceLanguage] = useState<ReferenceLanguage>(
    initialDraft?.referenceLanguage ?? "en",
  );
  const [preview, setPreview] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [client] = useState(() => createOcrClient());
  const generation = useRef(0);
  const saveRevision = useRef(0);

  useEffect(
    () => () => {
      generation.current++;
      client.cancel();
    },
    [client],
  );
  useEffect(() => {
    if (!draft?.image) return;
    const url = URL.createObjectURL(draft.image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft?.image]);

  async function save(next: OcrImport) {
    const revision = ++saveRevision.current;
    draftRef.current = next;
    setDraft(next);
    onDraftChange(next);
    setStorageError(false);
    setNotice("Saving image draft…");
    const result = await persistence.saveOcrImport(next);
    if (revision !== saveRevision.current) return result;
    if (result.kind === "unavailable") {
      setStorageError(true);
      setNotice(result.reason);
    } else if (result.kind === "saved")
      setNotice("Image draft saved in this browser.");
    return result;
  }

  function cancel() {
    generation.current++;
    client.cancel();
    setProgress(null);
  }

  async function selectImage(image: Blob) {
    cancel();
    setPreview(false);
    try {
      const next = {
        ...createOcrImport(image, language, crypto.randomUUID()),
        mode,
        referenceLanguage,
      };
      persistence.beginReviewContent();
      await save(next);
    } catch {
      setNotice("Choose a PNG, JPEG, WebP or BMP image up to 25 MiB.");
    }
  }

  function paste(event: ClipboardEvent) {
    const images = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length > 0) {
      event.preventDefault();
      if (images.length !== 1) {
        setNotice("Paste one image at a time. No images were imported.");
        return;
      }
      void selectImage(images[0]!);
    }
  }

  async function readClipboard() {
    cancel();
    const operation = ++generation.current;
    try {
      const items = await navigator.clipboard.read();
      if (operation !== generation.current) return;
      const candidates = items.filter((item) =>
        item.types.some((type) => type.startsWith("image/")),
      );
      if (candidates.length !== 1) {
        setNotice(
          "Copy one image, then paste it here or choose an image file.",
        );
        return;
      }
      const item = candidates[0]!;
      const type = item.types.find((type) => type.startsWith("image/"))!;
      const image = await item.getType(type);
      if (operation === generation.current) await selectImage(image);
    } catch {
      if (operation !== generation.current) return;
      setNotice(
        "Clipboard access is unavailable. Use regular paste in this dialog or choose an image file.",
      );
    }
  }

  async function recognize() {
    const current = draftRef.current;
    if (!current) return;
    const operation = ++generation.current;
    setPreview(false);
    setProgress(0);
    const result = await client.recognize(
      { image: current.image, language },
      setProgress,
    );
    if (operation !== generation.current) return;
    setProgress(null);
    const latest = draftRef.current;
    if (!latest || latest.id !== current.id) return;
    if (result.kind === "recognized") {
      await save({
        ...latest,
        language,
        status: "recognized",
        rawText: result.text,
        confidence: result.confidence,
        editedText:
          latest.editedText === latest.rawText || latest.editedText === ""
            ? result.text
            : latest.editedText,
      });
    } else await save({ ...latest, status: result.kind });
  }

  async function startReview() {
    const operation = ++generation.current;
    const current = draftRef.current;
    if (!current) return;
    const result = await save(current);
    if (result.kind !== "saved" || operation !== generation.current) return;
    const session = reviewFromOcr(current, mode, referenceLanguage);
    const savedSession = await persistence.saveSession(session);
    if (operation !== generation.current) return;
    if (savedSession.kind !== "saved") {
      setStorageError(true);
      setNotice(
        "The review could not be saved. Keep this page open and retry.",
      );
      return;
    }
    onImport(session);
    onOpenChange(false);
  }

  const prepared = prepareImport(draft?.editedText ?? "", mode);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) cancel();
        onOpenChange(next);
      }}
    >
      <DialogContent className="workspace__image-dialog" onPaste={paste}>
        <DialogHeader>
          <DialogTitle>Import image</DialogTitle>
          <DialogDescription>
            Paste or choose an image. Recognition and correction stay in this
            browser. Check the text before importing.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="ocr-image">Image file</FieldLabel>
            <Input
              id="ocr-image"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/bmp"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void selectImage(file);
                event.currentTarget.value = "";
              }}
            />
            <FieldDescription>
              PNG, JPEG, WebP or BMP; up to 25 MiB and 24 megapixels. The
              original image is retained until Clear session.
            </FieldDescription>
            <Button variant="outline" onClick={() => void readClipboard()}>
              Paste clipboard image
            </Button>
          </Field>
          <Field>
            <FieldLabel>Image language</FieldLabel>
            <ToggleGroup
              aria-label="Image language"
              variant="outline"
              value={[language]}
              disabled={progress !== null}
              onValueChange={(values) => {
                const parsed = ocrLanguageSchema.safeParse(values[0]);
                if (parsed.success) {
                  setLanguage(parsed.data);
                  if (draft) void save({ ...draft, language: parsed.data });
                }
              }}
            >
              <ToggleGroupItem value="jpn">Japanese</ToggleGroupItem>
              <ToggleGroupItem value="chi_sim">
                Simplified Chinese
              </ToggleGroupItem>
              <ToggleGroupItem value="chi_tra">
                Traditional Chinese
              </ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>
              OCR uses Tesseract.js and Tesseract language data. First use
              downloads the selected model and engine from moyu.{" "}
              <a href="/ocr/v1/manifest.json" target="_blank" rel="noreferrer">
                Sources and licenses
              </a>
              .
            </FieldDescription>
          </Field>
        </FieldGroup>
        {draft ? (
          <>
            {imageUrl ? (
              <img
                className="workspace__ocr-image"
                src={imageUrl}
                alt="Original local image"
              />
            ) : null}
            {progress !== null ? (
              <div role="status">
                Recognizing locally… {Math.round(progress * 100)}%{" "}
                <Button
                  variant="outline"
                  onClick={() => {
                    cancel();
                    void save({ ...draft, status: "cancelled" });
                  }}
                >
                  Cancel recognition
                </Button>
              </div>
            ) : (
              <Button variant="outline" onClick={() => void recognize()}>
                {draft.status === "ready"
                  ? "Recognize image"
                  : "Retry recognition"}
              </Button>
            )}
            {draft.status === "recognized" ? (
              <Alert>
                <AlertTitle>Recognition complete — check every line</AlertTitle>
                <AlertDescription>
                  {!draft.rawText.trim()
                    ? "No text was found. Enter the text manually or retry with a clearer image."
                    : draft.confidence !== null && draft.confidence < 75
                      ? `Low confidence (${Math.round(draft.confidence)}%). Correct uncertain text below.`
                      : "OCR may miss or misread characters. Your manual corrections are preserved on retry."}
                </AlertDescription>
              </Alert>
            ) : null}
            {draft.status === "unavailable" || draft.status === "cancelled" ? (
              <Alert>
                <AlertTitle>
                  {draft.status === "cancelled"
                    ? "Recognition cancelled"
                    : "OCR is unavailable"}
                </AlertTitle>
                <AlertDescription>
                  Your original image is retained. Retry online if assets are
                  missing, use a smaller image, or type a correction below.
                </AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="ocr-correction">
                  Corrected image text
                </FieldLabel>
                <Textarea
                  id="ocr-correction"
                  className="workspace__import-textarea"
                  value={draft.editedText}
                  onChange={(event) => {
                    setPreview(false);
                    void save({
                      ...draft,
                      editedText: event.currentTarget.value,
                    });
                  }}
                />
                <FieldDescription>
                  Keep one entry per line. For paired imports, put each
                  reference directly after its source.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Image import format</FieldLabel>
                <ToggleGroup
                  aria-label="Image import format"
                  variant="outline"
                  value={[mode]}
                  onValueChange={(values) => {
                    if (
                      values[0] === "source-only" ||
                      values[0] === "alternating"
                    ) {
                      setMode(values[0]);
                      setPreview(false);
                      void save({ ...draft, mode: values[0] });
                    }
                  }}
                >
                  <ToggleGroupItem value="source-only">
                    Source only
                  </ToggleGroupItem>
                  <ToggleGroupItem value="alternating">
                    Alternating source and reference
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              {mode === "alternating" ? (
                <Field>
                  <FieldLabel>Image reference language</FieldLabel>
                  <ToggleGroup
                    aria-label="Image reference language"
                    variant="outline"
                    value={[referenceLanguage]}
                    onValueChange={(values) => {
                      if (values[0] === "en" || values[0] === "vi") {
                        setReferenceLanguage(values[0]);
                        void save({ ...draft, referenceLanguage: values[0] });
                      }
                    }}
                  >
                    <ToggleGroupItem value="en">English</ToggleGroupItem>
                    <ToggleGroupItem value="vi">Vietnamese</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              ) : null}
            </FieldGroup>
            {preview ? (
              <ol
                className="workspace__ocr-pairs"
                aria-label="Image import preview"
              >
                {prepared.lines.map((line, index) => (
                  <li key={index}>
                    <strong>{index + 1}.</strong>
                    <p>{line.source || "Blank source line"}</p>
                    {line.reference !== undefined ? (
                      <p>{line.reference}</p>
                    ) : (
                      <small>No reference</small>
                    )}
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        ) : null}
        {notice ? (
          <p role={storageError ? "alert" : "status"}>{notice}</p>
        ) : null}
        {storageError && draft ? (
          <Button variant="outline" onClick={() => void save(draft)}>
            Retry saving image draft
          </Button>
        ) : null}
        <DialogFooter>
          {draft ? (
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="ghost" />}>
                Clear session
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear this local session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes the original images, OCR drafts and review
                    content from this browser. Personal terminology and settings
                    remain.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep session</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      cancel();
                      onClear();
                      onOpenChange(false);
                    }}
                  >
                    Clear session
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <Button
            disabled={!draft?.editedText.trim() || progress !== null}
            onClick={() => {
              if (preview) void startReview();
              else setPreview(true);
            }}
          >
            {preview ? "Start local review" : "Preview image import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

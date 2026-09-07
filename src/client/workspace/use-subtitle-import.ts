"use client";

import { useEffect, useRef, useState } from "react";

import { createSubtitleReviewSession } from "./import";
import type { ReferenceLanguage, ReviewSession, SourceLanguage } from "./model";
import type { WorkspacePersistenceQueue } from "./session-persistence";
import type { WorkspacePreferences } from "./session-store";
import {
  type RequestedSubtitleEncoding,
  type SubtitleArtifact,
  type SubtitleFileRole,
  type SubtitleImportDraft,
  type SubtitleProcessingFailure,
} from "./subtitles/contracts";
import { isSubtitleDraftReady } from "./subtitles/draft";
import { detectUnicodeBom } from "./subtitles/decode";
import { validateSubtitleFileMetadata } from "./subtitles/file-validation";
import {
  referencedSubtitleArtifactIds,
  type PersistedSubtitleImport,
} from "./subtitles/import-record";
import {
  createSubtitleWorkerClient,
  type SubtitleWorkerClient,
} from "./subtitles/worker-client";

export type FileSlotError = Readonly<{
  role: SubtitleFileRole;
  message: string;
}>;

export type SubtitleImportUiState =
  | { kind: "idle"; restoredImport: PersistedSubtitleImport | null }
  | {
      kind: "configuring";
      importState: PersistedSubtitleImport | null;
      errors: readonly FileSlotError[];
    }
  | {
      kind: "processing";
      operationId: string;
      importState: PersistedSubtitleImport;
    }
  | {
      kind: "aligning";
      importState: PersistedSubtitleImport;
      draft: SubtitleImportDraft;
    }
  | {
      kind: "error";
      importState: PersistedSubtitleImport;
      failure: SubtitleProcessingFailure;
    };

export type StartSubtitleReviewResult =
  | { kind: "started"; session: ReviewSession }
  | { kind: "not-ready" }
  | { kind: "storage-error"; reason: string };

export interface SubtitleImportController {
  state: SubtitleImportUiState;
  openFiles(): void;
  closeFiles(): void;
  setFile(role: "source" | "reference", file: File | null): void;
  setSourceLanguage(language: SourceLanguage): void;
  setReferenceLanguage(language: ReferenceLanguage): void;
  setEncoding(
    role: "source" | "reference",
    encoding: RequestedSubtitleEncoding,
  ): void;
  processFiles(): Promise<void>;
  revertFailedReplacement(role: "source" | "reference"): Promise<void>;
  updateDraft(
    update: (draft: SubtitleImportDraft) => SubtitleImportDraft,
  ): void;
  saveDraft(): Promise<void>;
  clearDraft(): Promise<void>;
  startReview(): Promise<StartSubtitleReviewResult>;

  readonly artifacts: readonly SubtitleArtifact[];
  readonly sourceLanguage: SourceLanguage;
  readonly referenceLanguage: ReferenceLanguage;
  readonly sourceEncoding: RequestedSubtitleEncoding;
  readonly referenceEncoding: RequestedSubtitleEncoding;
  readonly showSpeakerNames: boolean;
  readonly notice: Readonly<{
    tone: "error" | "success";
    text: string;
  }> | null;
  artifactForRole(role: SubtitleFileRole): SubtitleArtifact | null;
  artifactById(artifactId: string): SubtitleArtifact | null;
  backToPaste(): void;
  openAlignment(): void;
  setShowSpeakerNames(showSpeakerNames: boolean): void;
  resetAfterClear(): void;
}

type UseSubtitleImportOptions = Readonly<{
  initialImport: PersistedSubtitleImport | null;
  initialArtifacts: readonly SubtitleArtifact[];
  initialPreferences: WorkspacePreferences;
  hasReviewSession: boolean;
  persistence: WorkspacePersistenceQueue;
  getEvidencePanelWidth: () => number;
  onCleared: () => void;
}>;

function importStateOf(
  state: SubtitleImportUiState,
): PersistedSubtitleImport | null {
  return state.kind === "idle" ? state.restoredImport : state.importState;
}

function initialState(
  importState: PersistedSubtitleImport | null,
  hasReviewSession: boolean,
): SubtitleImportUiState {
  if (!importState) return { kind: "idle", restoredImport: null };
  if (hasReviewSession && importState.draft) {
    return {
      kind: "aligning",
      importState,
      draft: importState.draft,
    };
  }
  if (importState.failure) {
    return { kind: "error", importState, failure: importState.failure };
  }
  if (importState.draft) {
    return { kind: "aligning", importState, draft: importState.draft };
  }
  return { kind: "configuring", importState, errors: [] };
}

function roleLabel(role: SubtitleFileRole) {
  return role === "source" ? "Source" : "Reference";
}

function slotError(
  role: SubtitleFileRole,
  message: string,
): readonly FileSlotError[] {
  return [{ role, message }];
}

function selectedArtifact(
  file: File,
  role: SubtitleFileRole,
  format: "srt" | "ass",
  encoding: RequestedSubtitleEncoding,
): SubtitleArtifact {
  return {
    id: crypto.randomUUID(),
    role,
    name: file.name,
    size: file.size,
    format,
    requestedEncoding: encoding,
    resolvedEncoding: null,
    bytes: file,
    status: "selected",
  };
}

function replacementFailure(
  failure: SubtitleProcessingFailure,
  artifact: SubtitleArtifact | undefined,
): SubtitleProcessingFailure {
  return {
    kind: "processing-error",
    role: failure.role,
    code: failure.code,
    retryable: failure.retryable,
    message:
      failure.code === "invalid-encoding" && artifact
        ? `The file is not valid ${artifact.requestedEncoding}.`
        : failure.message,
  };
}

export function useSubtitleImport({
  initialImport,
  initialArtifacts,
  initialPreferences,
  hasReviewSession,
  persistence,
  getEvidencePanelWidth,
  onCleared,
}: UseSubtitleImportOptions): SubtitleImportController {
  const [state, setState] = useState<SubtitleImportUiState>(() =>
    initialState(initialImport, hasReviewSession),
  );
  const stateRef = useRef(state);
  const [artifacts, setArtifacts] =
    useState<readonly SubtitleArtifact[]>(initialArtifacts);
  const artifactsRef = useRef(artifacts);
  const [sourceLanguage, setSourceLanguageState] = useState<SourceLanguage>(
    initialImport?.source.language ?? "ja",
  );
  const [referenceLanguage, setReferenceLanguageState] =
    useState<ReferenceLanguage>(initialImport?.reference?.language ?? "en");
  const initialSourceArtifact = initialArtifacts.find(
    (artifact) => artifact.id === initialImport?.source.artifactId,
  );
  const initialReferenceArtifact = initialArtifacts.find(
    (artifact) => artifact.id === initialImport?.reference?.artifactId,
  );
  const [sourceEncoding, setSourceEncoding] =
    useState<RequestedSubtitleEncoding>(
      initialSourceArtifact?.requestedEncoding ?? "utf-8",
    );
  const [referenceEncoding, setReferenceEncoding] =
    useState<RequestedSubtitleEncoding>(
      initialReferenceArtifact?.requestedEncoding ?? "utf-8",
    );
  const [showSpeakerNames, setShowSpeakerNamesState] = useState(
    initialPreferences.showSpeakerNames,
  );
  const [notice, setNotice] =
    useState<SubtitleImportController["notice"]>(null);
  const workerRef = useRef<SubtitleWorkerClient | null>(null);
  const latestOperationRef = useRef<string | null>(null);
  const storageFailureRef = useRef<string | null>(null);

  function commitState(nextState: SubtitleImportUiState) {
    stateRef.current = nextState;
    setState(nextState);
  }

  function commitArtifacts(nextArtifacts: readonly SubtitleArtifact[]) {
    artifactsRef.current = nextArtifacts;
    setArtifacts(nextArtifacts);
  }

  function ensureWorker() {
    workerRef.current ??= createSubtitleWorkerClient();
    return workerRef.current;
  }

  async function persistImport(
    importState: PersistedSubtitleImport,
    putArtifacts: readonly SubtitleArtifact[] = [],
    deleteArtifactIds: readonly string[] = [],
  ) {
    const result = await persistence.saveSubtitleImport({
      importState,
      putArtifacts,
      deleteArtifactIds,
    });
    if (result.kind === "unavailable") {
      storageFailureRef.current = result.reason;
      setNotice({ tone: "error", text: result.reason });
    } else if (result.kind === "saved") {
      storageFailureRef.current = null;
    }
    return result;
  }

  useEffect(
    () => () => {
      latestOperationRef.current = null;
      workerRef.current?.dispose();
      workerRef.current = null;
    },
    [],
  );

  function openFiles() {
    try {
      ensureWorker();
    } catch {
      const importState = importStateOf(stateRef.current);
      commitState({
        kind: "configuring",
        importState,
        errors: slotError(
          "source",
          "Local subtitle processing is unavailable in this browser.",
        ),
      });
      return;
    }
    const importState = importStateOf(stateRef.current);
    if (importState?.failure) {
      commitState({
        kind: "error",
        importState,
        failure: importState.failure,
      });
    } else {
      commitState({ kind: "configuring", importState, errors: [] });
    }
  }

  function closeFiles() {
    latestOperationRef.current = null;
    const importState = importStateOf(stateRef.current);
    if (importState?.draft) {
      commitState({
        kind: "aligning",
        importState,
        draft: importState.draft,
      });
    } else {
      commitState({ kind: "idle", restoredImport: importState });
    }
  }

  function setFile(role: SubtitleFileRole, file: File | null) {
    latestOperationRef.current = null;
    const current = importStateOf(stateRef.current);
    if (!file) {
      if (role === "source") {
        commitState({
          kind: "configuring",
          importState: current,
          errors: slotError("source", "A source subtitle file is required."),
        });
        return;
      }
      if (!current?.reference) return;
      const nextImport: PersistedSubtitleImport = {
        ...current,
        reference: null,
        failure: null,
      };
      const removedId = current.reference.artifactId;
      const deleteArtifactIds =
        removedId === current.draft?.referenceArtifactId ? [] : [removedId];
      commitArtifacts(
        artifactsRef.current.filter(
          (artifact) => !deleteArtifactIds.includes(artifact.id),
        ),
      );
      commitState({ kind: "configuring", importState: nextImport, errors: [] });
      void persistImport(nextImport, [], deleteArtifactIds);
      return;
    }

    const validation = validateSubtitleFileMetadata({
      name: file.name,
      size: file.size,
    });
    if (validation.kind !== "valid") {
      const message =
        validation.kind === "too-large"
          ? `${roleLabel(role)} subtitle file exceeds the 25 MiB limit.`
          : validation.kind === "unsupported-format"
            ? `${roleLabel(role)} subtitle file must use .srt or .ass.`
            : `${roleLabel(role)} subtitle file metadata is invalid.`;
      commitState({
        kind: "configuring",
        importState: current,
        errors: slotError(role, message),
      });
      return;
    }
    if (role === "reference" && !current) {
      commitState({
        kind: "configuring",
        importState: null,
        errors: slotError(
          role,
          "Choose a source subtitle file before adding a reference file.",
        ),
      });
      return;
    }

    const encoding = role === "source" ? sourceEncoding : referenceEncoding;
    const artifact = selectedArtifact(file, role, validation.format, encoding);
    if (!current) persistence.beginReviewContent();
    const importId = current?.id ?? crypto.randomUUID();
    const nextImport: PersistedSubtitleImport =
      role === "source"
        ? {
            version: 1,
            id: importId,
            source: { artifactId: artifact.id, language: sourceLanguage },
            reference: current?.reference ?? null,
            draft: current?.draft ?? null,
            failure: null,
          }
        : {
            ...current!,
            reference: {
              artifactId: artifact.id,
              language: referenceLanguage,
            },
            failure: null,
          };

    const priorSelectedId =
      role === "source"
        ? current?.source.artifactId
        : current?.reference?.artifactId;
    const retainedDraftId =
      role === "source"
        ? current?.draft?.sourceArtifactId
        : current?.draft?.referenceArtifactId;
    const deleteArtifactIds =
      priorSelectedId &&
      priorSelectedId !== retainedDraftId &&
      priorSelectedId !== artifact.id
        ? [priorSelectedId]
        : [];
    commitArtifacts([
      ...artifactsRef.current.filter(
        (candidate) =>
          candidate.id !== artifact.id &&
          !deleteArtifactIds.includes(candidate.id),
      ),
      artifact,
    ]);
    commitState({ kind: "configuring", importState: nextImport, errors: [] });
    void persistImport(nextImport, [artifact], deleteArtifactIds);
  }

  function setSourceLanguage(language: SourceLanguage) {
    latestOperationRef.current = null;
    setSourceLanguageState(language);
    const current = importStateOf(stateRef.current);
    if (!current) return;
    const nextImport = {
      ...current,
      source: { ...current.source, language },
    };
    commitState({ kind: "configuring", importState: nextImport, errors: [] });
    void persistImport(nextImport);
  }

  function setReferenceLanguage(language: ReferenceLanguage) {
    latestOperationRef.current = null;
    setReferenceLanguageState(language);
    const current = importStateOf(stateRef.current);
    if (!current?.reference) return;
    const nextImport = {
      ...current,
      reference: { ...current.reference, language },
    };
    commitState({ kind: "configuring", importState: nextImport, errors: [] });
    void persistImport(nextImport);
  }

  function setEncoding(
    role: SubtitleFileRole,
    encoding: RequestedSubtitleEncoding,
  ) {
    latestOperationRef.current = null;
    if (role === "source") setSourceEncoding(encoding);
    else setReferenceEncoding(encoding);
    const current = importStateOf(stateRef.current);
    const artifactId =
      role === "source"
        ? current?.source.artifactId
        : current?.reference?.artifactId;
    const artifact = artifactsRef.current.find(
      (candidate) => candidate.id === artifactId,
    );
    if (!current || !artifact) return;
    if (artifact.requestedEncoding === encoding) return;
    const draftArtifactId =
      role === "source"
        ? current.draft?.sourceArtifactId
        : current.draft?.referenceArtifactId;
    const nextArtifact: SubtitleArtifact = {
      ...artifact,
      id: artifact.id === draftArtifactId ? crypto.randomUUID() : artifact.id,
      requestedEncoding: encoding,
      resolvedEncoding: null,
      status: "selected",
    };
    commitArtifacts([
      ...artifactsRef.current.filter(
        (candidate) => candidate.id !== nextArtifact.id,
      ),
      nextArtifact,
    ]);
    const nextImport: PersistedSubtitleImport =
      role === "source"
        ? {
            ...current,
            source: { ...current.source, artifactId: nextArtifact.id },
            failure: null,
          }
        : {
            ...current,
            reference: {
              artifactId: nextArtifact.id,
              language: current.reference?.language ?? referenceLanguage,
            },
            failure: null,
          };
    commitState({ kind: "configuring", importState: nextImport, errors: [] });
    void persistImport(nextImport, [nextArtifact]);
  }

  async function processFiles() {
    const current = importStateOf(stateRef.current);
    const sourceArtifact = artifactsRef.current.find(
      (artifact) => artifact.id === current?.source.artifactId,
    );
    const referenceArtifact = artifactsRef.current.find(
      (artifact) => artifact.id === current?.reference?.artifactId,
    );
    if (!current || !sourceArtifact) {
      commitState({
        kind: "configuring",
        importState: current,
        errors: slotError("source", "A source subtitle file is required."),
      });
      return;
    }

    const operationId = crypto.randomUUID();
    latestOperationRef.current = operationId;
    commitState({ kind: "processing", operationId, importState: current });
    await persistence.settle();
    if (latestOperationRef.current !== operationId) return;
    if (storageFailureRef.current) {
      const retainedIds = referencedSubtitleArtifactIds(current);
      const retry = await persistImport(
        current,
        artifactsRef.current.filter((artifact) => retainedIds.has(artifact.id)),
      );
      if (latestOperationRef.current !== operationId) return;
      if (retry.kind !== "saved") {
        latestOperationRef.current = null;
        commitState({
          kind: "configuring",
          importState: current,
          errors: slotError(
            "source",
            retry.kind === "unavailable"
              ? retry.reason
              : "The local subtitle import could not be saved.",
          ),
        });
        return;
      }
    }

    let worker: SubtitleWorkerClient;
    try {
      worker = ensureWorker();
    } catch {
      commitState({
        kind: "configuring",
        importState: current,
        errors: slotError(
          "source",
          "Local subtitle processing is unavailable in this browser.",
        ),
      });
      return;
    }
    let sourceBytes: ArrayBuffer;
    let referenceBytes: ArrayBuffer | undefined;
    try {
      sourceBytes = await sourceArtifact.bytes.arrayBuffer();
      referenceBytes = await referenceArtifact?.bytes.arrayBuffer();
    } catch {
      if (latestOperationRef.current !== operationId) return;
      commitState({
        kind: "configuring",
        importState: current,
        errors: slotError(
          "source",
          "The selected subtitle file could not be read locally.",
        ),
      });
      return;
    }

    if (latestOperationRef.current !== operationId) return;
    const sourceResolvedEncoding =
      detectUnicodeBom(new Uint8Array(sourceBytes))?.encoding ??
      sourceArtifact.requestedEncoding;
    const referenceResolvedEncoding = referenceBytes
      ? (detectUnicodeBom(new Uint8Array(referenceBytes))?.encoding ??
        referenceArtifact?.requestedEncoding)
      : undefined;
    const result = await worker.process({
      version: 1,
      operationId,
      source: {
        artifactId: sourceArtifact.id,
        format: sourceArtifact.format,
        encoding: sourceArtifact.requestedEncoding,
        bytes: sourceBytes,
      },
      ...(referenceArtifact && referenceBytes
        ? {
            reference: {
              artifactId: referenceArtifact.id,
              format: referenceArtifact.format,
              encoding: referenceArtifact.requestedEncoding,
              bytes: referenceBytes,
            },
          }
        : {}),
      sourceLanguage: current.source.language,
      referenceLanguage: current.reference?.language ?? referenceLanguage,
    });
    if (latestOperationRef.current !== operationId) return;
    if (result.kind === "superseded" || result.kind === "disposed") return;

    if (result.kind === "processing-error") {
      const failedArtifact =
        result.role === "source" ? sourceArtifact : referenceArtifact;
      const failure = replacementFailure(result, failedArtifact);
      const markedArtifact = failedArtifact
        ? ({
            ...failedArtifact,
            resolvedEncoding: null,
            status: "failed",
          } satisfies SubtitleArtifact)
        : null;
      const nextImport = { ...current, failure };
      if (markedArtifact) {
        commitArtifacts(
          artifactsRef.current.map((artifact) =>
            artifact.id === markedArtifact.id ? markedArtifact : artifact,
          ),
        );
      }
      await persistImport(nextImport, markedArtifact ? [markedArtifact] : []);
      if (latestOperationRef.current !== operationId) return;
      latestOperationRef.current = null;
      commitState({ kind: "error", importState: nextImport, failure });
      return;
    }

    const draft: SubtitleImportDraft = {
      ...result.draft,
      id: current.id,
    };
    const decodedArtifacts = [sourceArtifact, referenceArtifact]
      .filter((artifact): artifact is SubtitleArtifact => Boolean(artifact))
      .map((artifact): SubtitleArtifact => ({
        ...artifact,
        resolvedEncoding:
          artifact.role === "source"
            ? sourceResolvedEncoding
            : (referenceResolvedEncoding ?? artifact.requestedEncoding),
        status: "decoded",
      }));
    const nextImport: PersistedSubtitleImport = {
      ...current,
      draft,
      failure: null,
    };
    const retainedIds = referencedSubtitleArtifactIds(nextImport);
    const deleteArtifactIds = [
      ...referencedSubtitleArtifactIds(current),
    ].filter((artifactId) => !retainedIds.has(artifactId));
    const resultSave = await persistImport(
      nextImport,
      decodedArtifacts,
      deleteArtifactIds,
    );
    if (latestOperationRef.current !== operationId) return;
    latestOperationRef.current = null;
    if (resultSave.kind !== "saved") {
      const failure: SubtitleProcessingFailure = {
        kind: "processing-error",
        role: "source",
        code: "unexpected-error",
        retryable: true,
        message:
          resultSave.kind === "unavailable"
            ? resultSave.reason
            : "The local subtitle import could not be saved.",
      };
      commitState({ kind: "error", importState: current, failure });
      return;
    }
    commitArtifacts(
      artifactsRef.current
        .filter((artifact) => !deleteArtifactIds.includes(artifact.id))
        .map(
          (artifact) =>
            decodedArtifacts.find((decoded) => decoded.id === artifact.id) ??
            artifact,
        ),
    );
    setNotice(null);
    commitState({ kind: "aligning", importState: nextImport, draft });
  }

  async function revertFailedReplacement(role: SubtitleFileRole) {
    const current = importStateOf(stateRef.current);
    const draft = current?.draft;
    if (!current || !draft) return;
    const previousArtifactId =
      role === "source" ? draft.sourceArtifactId : draft.referenceArtifactId;
    const failedArtifactId =
      role === "source"
        ? current.source.artifactId
        : current.reference?.artifactId;
    if (!failedArtifactId) return;
    const nextImport: PersistedSubtitleImport =
      role === "source"
        ? {
            ...current,
            source: {
              artifactId: draft.sourceArtifactId,
              language: draft.sourceLanguage,
            },
            failure: null,
          }
        : {
            ...current,
            reference: previousArtifactId
              ? {
                  artifactId: previousArtifactId,
                  language: draft.referenceLanguage,
                }
              : null,
            failure: null,
          };
    const deleteArtifactIds =
      failedArtifactId === previousArtifactId ? [] : [failedArtifactId];
    const result = await persistImport(nextImport, [], deleteArtifactIds);
    if (result.kind !== "saved") return;
    const restoredArtifact = previousArtifactId
      ? artifactById(previousArtifactId)
      : null;
    if (role === "source") {
      setSourceLanguageState(draft.sourceLanguage);
      if (restoredArtifact)
        setSourceEncoding(restoredArtifact.requestedEncoding);
    } else {
      setReferenceLanguageState(draft.referenceLanguage);
      if (restoredArtifact)
        setReferenceEncoding(restoredArtifact.requestedEncoding);
    }
    commitArtifacts(
      artifactsRef.current.filter(
        (artifact) => !deleteArtifactIds.includes(artifact.id),
      ),
    );
    commitState({ kind: "aligning", importState: nextImport, draft });
  }

  function updateDraft(
    update: (draft: SubtitleImportDraft) => SubtitleImportDraft,
  ) {
    const current = importStateOf(stateRef.current);
    if (!current?.draft) return;
    const draft = update(current.draft);
    const nextImport = { ...current, draft };
    commitState({ kind: "aligning", importState: nextImport, draft });
    void persistImport(nextImport);
  }

  async function saveDraft() {
    const current = importStateOf(stateRef.current);
    if (!current?.draft) return;
    const result = await persistImport(current);
    await persistence.settle();
    if (result.kind === "saved") {
      setNotice({ tone: "success", text: "Local subtitle draft saved." });
    }
  }

  async function clearDraft() {
    latestOperationRef.current = null;
    const result = await persistence.clearReviewContent();
    if (result.kind === "unavailable") {
      setNotice({ tone: "error", text: result.reason });
      return;
    }
    resetAfterClear();
    setNotice({ tone: "success", text: "Local review content was cleared." });
    onCleared();
  }

  function resetAfterClear() {
    latestOperationRef.current = null;
    workerRef.current?.dispose();
    workerRef.current = null;
    storageFailureRef.current = null;
    commitArtifacts([]);
    commitState({ kind: "idle", restoredImport: null });
  }

  async function startReview(): Promise<StartSubtitleReviewResult> {
    const current = importStateOf(stateRef.current);
    if (
      !current?.draft ||
      current.failure ||
      current.source.artifactId !== current.draft.sourceArtifactId ||
      current.reference?.artifactId !== current.draft.referenceArtifactId ||
      current.source.language !== current.draft.sourceLanguage ||
      (current.reference !== null &&
        current.reference.language !== current.draft.referenceLanguage) ||
      !isSubtitleDraftReady(current.draft)
    ) {
      return { kind: "not-ready" };
    }
    await saveDraft();
    if (importStateOf(stateRef.current) !== current)
      return { kind: "not-ready" };
    if (storageFailureRef.current) {
      return { kind: "storage-error", reason: storageFailureRef.current };
    }
    const created = createSubtitleReviewSession(
      current.draft,
      getEvidencePanelWidth(),
    );
    if (created.kind !== "created") return { kind: "not-ready" };
    const saved = await persistence.saveSession(created.session);
    if (saved.kind !== "saved") {
      const reason =
        saved.kind === "unavailable"
          ? saved.reason
          : "The local review session could not be saved.";
      setNotice({ tone: "error", text: reason });
      return { kind: "storage-error", reason };
    }
    return { kind: "started", session: created.session };
  }

  function artifactById(artifactId: string) {
    return (
      artifactsRef.current.find((artifact) => artifact.id === artifactId) ??
      null
    );
  }

  function artifactForRole(role: SubtitleFileRole) {
    const current = importStateOf(stateRef.current);
    const artifactId =
      role === "source"
        ? current?.source.artifactId
        : current?.reference?.artifactId;
    return artifactId ? artifactById(artifactId) : null;
  }

  function backToPaste() {
    latestOperationRef.current = null;
    commitState({
      kind: "idle",
      restoredImport: importStateOf(stateRef.current),
    });
  }

  function openAlignment() {
    const importState = importStateOf(stateRef.current);
    if (!importState?.draft) return;
    commitState({
      kind: "aligning",
      importState,
      draft: importState.draft,
    });
  }

  function setShowSpeakerNames(show: boolean) {
    setShowSpeakerNamesState(show);
    void persistence
      .savePreferences({ showSpeakerNames: show })
      .then((result) => {
        if (result.kind === "unavailable") {
          setNotice({ tone: "error", text: result.reason });
        }
      });
  }

  return {
    state,
    artifacts,
    sourceLanguage,
    referenceLanguage,
    sourceEncoding,
    referenceEncoding,
    showSpeakerNames,
    notice,
    openFiles,
    closeFiles,
    setFile,
    setSourceLanguage,
    setReferenceLanguage,
    setEncoding,
    processFiles,
    revertFailedReplacement,
    updateDraft,
    saveDraft,
    clearDraft,
    startReview,
    artifactForRole,
    artifactById,
    backToPaste,
    openAlignment,
    setShowSpeakerNames,
    resetAfterClear,
  };
}

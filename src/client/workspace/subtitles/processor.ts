import { decodeSubtitleBytes } from "./decode";
import { createSubtitleImportDraft } from "./draft";
import { parseSubtitle } from "./parser";
import {
  type ProcessSubtitleRequest,
  type ProcessSubtitleResponse,
  type SubtitleDecodeFailure,
  type SubtitleParseFailure,
  type SubtitleParseResult,
  type SubtitleFileRole,
  type SubtitleWorkerFile,
  type SubtitleProcessingFailureCode,
  type SubtitleCue,
  type SubtitleWorkerResponse,
  subtitleWorkerRequestSchema,
  subtitleWorkerResponseSchema,
} from "./contracts";

const INVALID_OPERATION_ID = "invalid-worker-message";

function failureMessage(code: SubtitleProcessingFailureCode) {
  switch (code) {
    case "invalid-encoding":
      return "The subtitle file could not be decoded with the selected encoding.";
    case "missing-events":
    case "missing-format":
    case "missing-column":
    case "malformed-dialogue":
      return "The subtitle file could not be parsed.";
    case "invalid-worker-message":
      return "The subtitle worker message was invalid.";
    case "unexpected-error":
      return "The subtitle worker could not process the file.";
  }
}

function processingError(
  operationId: string,
  role: "source" | "reference",
  failure: SubtitleDecodeFailure | SubtitleParseFailure,
): ProcessSubtitleResponse {
  return {
    version: 1,
    operationId,
    kind: "processing-error",
    role,
    code: failure.kind === "invalid-encoding" ? failure.kind : failure.code,
    retryable: true,
    message: failureMessage(
      failure.kind === "invalid-encoding" ? failure.kind : failure.code,
    ),
  };
}

function unexpectedError(operationId: string): ProcessSubtitleResponse {
  return {
    version: 1,
    operationId,
    kind: "processing-error",
    role: "source",
    code: "unexpected-error",
    retryable: true,
    message: failureMessage("unexpected-error"),
  };
}

export function unexpectedWorkerFailureResponse(
  operationId: string,
): ProcessSubtitleResponse {
  return validatedResponse(unexpectedError(operationId));
}

export function invalidWorkerMessageResponse(
  operationId = INVALID_OPERATION_ID,
): ProcessSubtitleResponse {
  return {
    version: 1,
    operationId,
    kind: "processing-error",
    role: "source",
    code: "invalid-worker-message",
    retryable: true,
    message: failureMessage("invalid-worker-message"),
  };
}

function validatedResponse(response: ProcessSubtitleResponse) {
  const parsed = subtitleWorkerResponseSchema.safeParse(response);
  return parsed.success
    ? (parsed.data as SubtitleWorkerResponse)
    : invalidWorkerMessageResponse(response.operationId);
}

type ParsedFileResult = SubtitleDecodeFailure | SubtitleParseResult;
type FileParser = (
  role: SubtitleFileRole,
  file: SubtitleWorkerFile,
) => ParsedFileResult;

function decodeAndParseFile(file: SubtitleWorkerFile): ParsedFileResult {
  const decoded = decodeSubtitleBytes(file.bytes, file.encoding);
  if (decoded.kind !== "decoded") return decoded;
  return parseSubtitle({
    artifactId: file.artifactId,
    format: file.format,
    text: decoded.text,
  });
}

function processWithParser(
  request: ProcessSubtitleRequest,
  parseFile: FileParser,
): ProcessSubtitleResponse {
  const parsedRequest = subtitleWorkerRequestSchema.safeParse(request);
  if (!parsedRequest.success)
    return validatedResponse(invalidWorkerMessageResponse());

  const input = parsedRequest.data;
  try {
    const sourceParsed = parseFile("source", input.source);
    if (sourceParsed.kind !== "parsed") {
      return validatedResponse(
        processingError(input.operationId, "source", sourceParsed),
      );
    }

    let referenceCues: readonly SubtitleCue[] = [];
    if (input.reference !== undefined) {
      const referenceParsed = parseFile("reference", input.reference);
      if (referenceParsed.kind !== "parsed") {
        return validatedResponse(
          processingError(input.operationId, "reference", referenceParsed),
        );
      }
      referenceCues = referenceParsed.cues;
    }

    return validatedResponse({
      version: 1,
      operationId: input.operationId,
      kind: "processed",
      draft: createSubtitleImportDraft({
        id: input.operationId,
        sourceArtifactId: input.source.artifactId,
        ...(input.reference === undefined
          ? {}
          : { referenceArtifactId: input.reference.artifactId }),
        sourceLanguage: input.sourceLanguage,
        referenceLanguage: input.referenceLanguage,
        sourceCues: sourceParsed.cues,
        referenceCues,
      }),
    });
  } catch {
    return validatedResponse(unexpectedError(input.operationId));
  }
}

export function processSubtitleFiles(
  request: ProcessSubtitleRequest,
): ProcessSubtitleResponse {
  return processWithParser(request, (_role, file) => decodeAndParseFile(file));
}

type ParsedFileCache = Readonly<{
  artifactId: string;
  format: SubtitleWorkerFile["format"];
  encoding: SubtitleWorkerFile["encoding"];
  bytes: Uint8Array;
  result: Extract<SubtitleParseResult, { kind: "parsed" }>;
}>;

function matchesCachedFile(
  cached: ParsedFileCache | undefined,
  file: SubtitleWorkerFile,
): cached is ParsedFileCache {
  if (
    !cached ||
    cached.artifactId !== file.artifactId ||
    cached.format !== file.format ||
    cached.encoding !== file.encoding ||
    cached.bytes.byteLength !== file.bytes.byteLength
  )
    return false;
  const bytes = new Uint8Array(file.bytes);
  return cached.bytes.every((byte, index) => byte === bytes[index]);
}

/** One last-successful parse per role, scoped to a single worker lifetime. */
export function createSubtitleProcessor(): (
  request: ProcessSubtitleRequest,
) => ProcessSubtitleResponse {
  const cache: Partial<Record<SubtitleFileRole, ParsedFileCache>> = {};
  return (request) =>
    processWithParser(request, (role, file) => {
      const cached = cache[role];
      if (matchesCachedFile(cached, file)) return cached.result;
      const result = decodeAndParseFile(file);
      if (result.kind === "parsed") {
        cache[role] = {
          artifactId: file.artifactId,
          format: file.format,
          encoding: file.encoding,
          // Never retain the caller's mutable ArrayBuffer as comparison evidence.
          bytes: new Uint8Array(file.bytes.slice(0)),
          result,
        };
      }
      return result;
    });
}

import { decodeSubtitleBytes } from "./decode";
import { createSubtitleImportDraft } from "./draft";
import { parseSubtitle } from "./parser";
import {
  type ProcessSubtitleRequest,
  type ProcessSubtitleResponse,
  type SubtitleDecodeFailure,
  type SubtitleParseFailure,
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

export function processSubtitleFiles(
  request: ProcessSubtitleRequest,
): ProcessSubtitleResponse {
  const parsedRequest = subtitleWorkerRequestSchema.safeParse(request);
  if (!parsedRequest.success)
    return validatedResponse(invalidWorkerMessageResponse());

  const input = parsedRequest.data;
  try {
    const sourceDecoded = decodeSubtitleBytes(
      input.source.bytes,
      input.source.encoding,
    );
    if (sourceDecoded.kind !== "decoded") {
      return validatedResponse(
        processingError(input.operationId, "source", sourceDecoded),
      );
    }
    const sourceParsed = parseSubtitle({
      artifactId: input.source.artifactId,
      format: input.source.format,
      text: sourceDecoded.text,
    });
    if (sourceParsed.kind !== "parsed") {
      return validatedResponse(
        processingError(input.operationId, "source", sourceParsed),
      );
    }

    let referenceCues: readonly SubtitleCue[] = [];
    if (input.reference !== undefined) {
      const referenceDecoded = decodeSubtitleBytes(
        input.reference.bytes,
        input.reference.encoding,
      );
      if (referenceDecoded.kind !== "decoded") {
        return validatedResponse(
          processingError(input.operationId, "reference", referenceDecoded),
        );
      }
      const referenceParsed = parseSubtitle({
        artifactId: input.reference.artifactId,
        format: input.reference.format,
        text: referenceDecoded.text,
      });
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

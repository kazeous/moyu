import {
  type ProcessSubtitleResponse,
  type SubtitleWorkerRequest,
  subtitleWorkerRequestSchema,
  subtitleWorkerResponseEnvelopeSchema,
  subtitleWorkerResponseSchema,
} from "./contracts";
import { validateCueConservation } from "./draft";
import {
  invalidWorkerMessageResponse,
  unexpectedWorkerFailureResponse,
} from "./processor";

type MessageListener = (event: MessageEvent<unknown>) => void;
type FailureListener = (event: Event) => void;

export type SubtitleWorkerPort = Readonly<{
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: MessageListener): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: FailureListener,
  ): void;
  removeEventListener(type: "message", listener: MessageListener): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: FailureListener,
  ): void;
  terminate(): void;
}>;

export type SubtitleWorkerFactory = () => SubtitleWorkerPort;

export type SubtitleWorkerSuperseded = Readonly<{
  kind: "superseded";
  operationId: string;
}>;

export type SubtitleWorkerDisposed = Readonly<{
  kind: "disposed";
  operationId: string;
}>;

export type SubtitleWorkerClientResult =
  ProcessSubtitleResponse | SubtitleWorkerSuperseded | SubtitleWorkerDisposed;

export type SubtitleWorkerClient = Readonly<{
  process(input: unknown): Promise<SubtitleWorkerClientResult>;
  settle(): Promise<void>;
  dispose(): void;
}>;

type PendingOperation = Readonly<{
  promise: Promise<SubtitleWorkerClientResult>;
  resolve: (result: SubtitleWorkerClientResult) => void;
}>;

function defaultWorkerFactory(): SubtitleWorkerPort {
  return new Worker(new URL("./subtitle-worker.ts", import.meta.url), {
    type: "module",
  });
}

function transferList(request: SubtitleWorkerRequest): Transferable[] {
  const buffers = [request.source.bytes, request.reference?.bytes].filter(
    (buffer): buffer is ArrayBuffer => buffer !== undefined,
  );
  return [...new Set(buffers)];
}

function responseEnvelope(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return subtitleWorkerResponseEnvelopeSchema.safeParse(value);
  }
  const message = value as { version?: unknown; operationId?: unknown };
  return subtitleWorkerResponseEnvelopeSchema.safeParse({
    version: message.version,
    operationId: message.operationId,
  });
}

export function createSubtitleWorkerClient(
  factory: SubtitleWorkerFactory = defaultWorkerFactory,
): SubtitleWorkerClient {
  const worker = factory();
  const pending = new Map<string, PendingOperation>();
  let latestOperationId: string | null = null;
  let disposed = false;

  const settleOperation = (
    operationId: string,
    response: ProcessSubtitleResponse,
  ) => {
    const operation = pending.get(operationId);
    if (operation === undefined) return;
    pending.delete(operationId);
    if (operationId === latestOperationId) latestOperationId = null;
    operation.resolve(response);
  };

  const settleWorkerFailure = () => {
    for (const operationId of pending.keys()) {
      settleOperation(
        operationId,
        unexpectedWorkerFailureResponse(operationId),
      );
    }
  };

  const onMessage: MessageListener = (event) => {
    const envelope = responseEnvelope(event.data);
    if (!envelope.success || !pending.has(envelope.data.operationId)) return;

    const parsed = subtitleWorkerResponseSchema.safeParse(event.data);
    if (!parsed.success) {
      settleOperation(
        envelope.data.operationId,
        invalidWorkerMessageResponse(envelope.data.operationId),
      );
      return;
    }
    const response = parsed.data as unknown as ProcessSubtitleResponse;
    if (
      response.kind === "processed" &&
      validateCueConservation(response.draft).kind === "invalid"
    ) {
      settleOperation(
        envelope.data.operationId,
        invalidWorkerMessageResponse(envelope.data.operationId),
      );
      return;
    }
    settleOperation(envelope.data.operationId, response);
  };
  const onWorkerFailure: FailureListener = () => settleWorkerFailure();

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onWorkerFailure);
  worker.addEventListener("messageerror", onWorkerFailure);

  const supersedePending = () => {
    for (const [operationId, operation] of pending) {
      pending.delete(operationId);
      operation.resolve({ kind: "superseded", operationId });
    }
  };

  const process = (input: unknown): Promise<SubtitleWorkerClientResult> => {
    const parsed = subtitleWorkerRequestSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(invalidWorkerMessageResponse());
    if (disposed) {
      return Promise.resolve({
        kind: "disposed",
        operationId: parsed.data.operationId,
      });
    }

    supersedePending();
    latestOperationId = parsed.data.operationId;
    let resolve!: (result: SubtitleWorkerClientResult) => void;
    const promise = new Promise<SubtitleWorkerClientResult>((next) => {
      resolve = next;
    });
    pending.set(parsed.data.operationId, { promise, resolve });
    try {
      worker.postMessage(parsed.data, transferList(parsed.data));
    } catch {
      settleOperation(
        parsed.data.operationId,
        unexpectedWorkerFailureResponse(parsed.data.operationId),
      );
    }
    return promise;
  };

  return {
    process,
    async settle() {
      await Promise.all(
        [...pending.values()].map((operation) => operation.promise),
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerFailure);
      worker.removeEventListener("messageerror", onWorkerFailure);
      for (const [operationId, operation] of pending) {
        pending.delete(operationId);
        operation.resolve({ kind: "disposed", operationId });
      }
      worker.terminate();
    },
  };
}

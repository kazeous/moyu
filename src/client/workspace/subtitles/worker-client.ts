import {
  type ProcessSubtitleResponse,
  type SubtitleWorkerRequest,
  subtitleWorkerRequestSchema,
  subtitleWorkerResponseSchema,
} from "./contracts";
import { invalidWorkerMessageResponse } from "./processor";

type MessageListener = (event: MessageEvent<unknown>) => void;

export type SubtitleWorkerPort = Readonly<{
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: MessageListener): void;
  removeEventListener(type: "message", listener: MessageListener): void;
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

export function createSubtitleWorkerClient(
  factory: SubtitleWorkerFactory = defaultWorkerFactory,
): SubtitleWorkerClient {
  const worker = factory();
  const pending = new Map<string, PendingOperation>();
  let latestOperationId: string | null = null;
  let disposed = false;

  const settleInvalidWorkerMessage = () => {
    if (latestOperationId === null) return;
    const current = pending.get(latestOperationId);
    if (current === undefined) return;
    pending.delete(latestOperationId);
    current.resolve(invalidWorkerMessageResponse(latestOperationId));
  };

  const onMessage: MessageListener = (event) => {
    const parsed = subtitleWorkerResponseSchema.safeParse(event.data);
    if (!parsed.success) {
      settleInvalidWorkerMessage();
      return;
    }
    const current = pending.get(parsed.data.operationId);
    if (current === undefined) return;
    pending.delete(parsed.data.operationId);
    current.resolve(parsed.data as unknown as ProcessSubtitleResponse);
  };

  worker.addEventListener("message", onMessage);

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
    worker.postMessage(parsed.data, transferList(parsed.data));
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
      for (const [operationId, operation] of pending) {
        pending.delete(operationId);
        operation.resolve({ kind: "disposed", operationId });
      }
      worker.terminate();
    },
  };
}

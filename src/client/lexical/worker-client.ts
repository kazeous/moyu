import {
  workerRequestSchema,
  workerResponseSchema,
  type WorkerRequest,
  type WorkerResponse,
} from "./contracts";

type Listener = (event: MessageEvent<unknown>) => void;
export type LexicalWorkerPort = {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: Listener): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ): void;
  removeEventListener(type: "message", listener: Listener): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ): void;
  terminate(): void;
};
export type LexicalResult =
  WorkerResponse | { kind: "superseded" | "disposed"; id: string };
const unavailable = (
  id: string,
  reason: "invalid" | "worker" | "timeout",
): WorkerResponse => ({ kind: "unavailable", id, reason, retryable: true });

export function createLexicalWorkerClient(
  factory: () => LexicalWorkerPort = () =>
    new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  timeout = 180_000,
) {
  let worker: LexicalWorkerPort | null = factory();
  let disposed = false;
  let requiresReload = false;
  const pending = new Map<
    string,
    {
      input: WorkerRequest;
      resolve: (result: LexicalResult) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function settle(id: string, response: LexicalResult) {
    const job = pending.get(id);
    if (!job) return;
    clearTimeout(job.timer);
    pending.delete(id);
    job.resolve(response);
  }
  const onMessage: Listener = ({ data }) => {
    const parsed = workerResponseSchema.safeParse(data);
    if (!parsed.success) {
      for (const id of pending.keys()) settle(id, unavailable(id, "invalid"));
      return;
    }
    const response = parsed.data;
    const job = pending.get(response.id);
    if (!job) return;
    if (response.kind === "loaded" && job.input.kind === "load")
      requiresReload = false;
    if (response.kind === "analyzed") {
      const input = job.input;
      if (
        input.kind !== "analyze" ||
        response.analysis.language !== input.language
      ) {
        settle(response.id, unavailable(response.id, "invalid"));
        return;
      }
      const tokens = response.analysis.tokens;
      let offset = 0;
      const validTokens = tokens.every((token) => {
        const valid =
          token.start === offset &&
          token.end > token.start &&
          token.surface === input.source.slice(token.start, token.end);
        offset = token.end;
        return valid;
      });
      const validSpans = [
        ...response.analysis.alternatives,
        ...response.overlays,
      ].every(
        (span) =>
          span.end > span.start &&
          span.end <= input.source.length &&
          span.surface === input.source.slice(span.start, span.end),
      );
      if (!validTokens || offset !== input.source.length || !validSpans) {
        settle(response.id, unavailable(response.id, "invalid"));
        return;
      }
    }
    settle(response.id, response);
  };
  const onFailure = (event: Event) => {
    event.preventDefault();
    requiresReload = true;
    for (const id of pending.keys()) settle(id, unavailable(id, "worker"));
    detach();
  };
  function attach(port: LexicalWorkerPort) {
    port.addEventListener("message", onMessage);
    port.addEventListener("error", onFailure);
    port.addEventListener("messageerror", onFailure);
  }
  function detach() {
    if (!worker) return;
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onFailure);
    worker.removeEventListener("messageerror", onFailure);
    worker.terminate();
    worker = null;
  }
  attach(worker);
  return {
    request(input: WorkerRequest): Promise<LexicalResult> {
      const parsed = workerRequestSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(unavailable(input.id, "invalid"));
      if (disposed) return Promise.resolve({ kind: "disposed", id: input.id });
      if (requiresReload && input.kind === "analyze")
        return Promise.resolve(unavailable(input.id, "worker"));
      for (const [id, job] of pending) {
        if (job.input.kind === input.kind)
          settle(id, { kind: "superseded", id });
      }
      return new Promise((resolve) => {
        pending.set(input.id, {
          input: parsed.data,
          resolve,
          timer: setTimeout(
            () => settle(input.id, unavailable(input.id, "timeout")),
            timeout,
          ),
        });
        try {
          if (!worker) {
            worker = factory();
            attach(worker);
          }
          worker.postMessage(parsed.data);
        } catch {
          requiresReload = true;
          detach();
          settle(input.id, unavailable(input.id, "worker"));
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of pending.keys()) settle(id, { kind: "disposed", id });
      detach();
    },
  };
}
export type LexicalWorkerClient = ReturnType<typeof createLexicalWorkerClient>;

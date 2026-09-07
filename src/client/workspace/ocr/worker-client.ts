import {
  ocrRequestSchema,
  ocrResponseSchema,
  type OcrLanguage,
  type OcrResponse,
} from "./contracts";

type Result =
  Exclude<OcrResponse, { kind: "progress" }> | { kind: "cancelled" };
export function createOcrClient(
  factory: () => Worker = () =>
    new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  timeoutMs = 120_000,
) {
  let cancelCurrent: (() => void) | null = null;
  return {
    cancel() {
      cancelCurrent?.();
    },
    recognize(
      input: { image: Blob; language: OcrLanguage },
      onProgress: (progress: number) => void,
    ): Promise<Result> {
      cancelCurrent?.();
      if (!ocrRequestSchema.safeParse(input).success)
        return Promise.resolve({ kind: "unavailable" });
      return new Promise((resolve) => {
        let worker: Worker | undefined;
        let finished = false;
        const finish = (result: Result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          worker?.terminate();
          cancelCurrent = null;
          resolve(result);
        };
        const timer = setTimeout(
          () => finish({ kind: "unavailable" }),
          timeoutMs,
        );
        cancelCurrent = () => finish({ kind: "cancelled" });
        try {
          worker = factory();
          worker.addEventListener("message", (event: MessageEvent<unknown>) => {
            if (finished) return;
            const result = ocrResponseSchema.safeParse(event.data);
            if (!result.success) return finish({ kind: "unavailable" });
            if (result.data.kind === "progress")
              onProgress(result.data.progress);
            else finish(result.data);
          });
          worker.addEventListener("error", () =>
            finish({ kind: "unavailable" }),
          );
          worker.addEventListener("messageerror", () =>
            finish({ kind: "unavailable" }),
          );
          worker.postMessage(input);
        } catch {
          finish({ kind: "unavailable" });
        }
      });
    },
  };
}

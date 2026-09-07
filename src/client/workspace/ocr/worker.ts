import { createWorker, OEM, PSM } from "tesseract.js";
import { ocrRequestSchema, ocrResponseSchema } from "./contracts";

// An outer worker owns decoding and the OCR worker so cancellation also stops
// initialization/downloads. Imported bytes never become a URL or request body.
self.addEventListener("message", async (event: MessageEvent<unknown>) => {
  const input = ocrRequestSchema.safeParse(event.data);
  if (!input.success) return self.postMessage({ kind: "unavailable" });
  let engine: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const bitmap = await createImageBitmap(input.data.image);
    const pixels = bitmap.width * bitmap.height;
    bitmap.close();
    if (pixels > 24_000_000)
      throw new Error("Image dimensions exceed the local OCR limit.");
    const base = `${self.location.origin}/ocr/v1`;
    engine = await createWorker(input.data.language, OEM.LSTM_ONLY, {
      workerPath: `${base}/worker.min.js`,
      corePath: `${base}/core`,
      langPath: `${base}/lang`,
      workerBlobURL: false,
      cacheMethod: "none",
      // Tesseract 6 does not reject its initialization promise for model-load
      // errors. Notify the owner immediately so it can terminate this worker.
      errorHandler: () => self.postMessage({ kind: "unavailable" }),
      logger: ({ status, progress }) => {
        if (status === "recognizing text" && Number.isFinite(progress)) {
          self.postMessage({
            kind: "progress",
            progress: Math.max(0, Math.min(1, progress)),
          });
        }
      },
    });
    await engine.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
    });
    const result = await engine.recognize(input.data.image, {}, { text: true });
    self.postMessage(
      ocrResponseSchema.parse({
        kind: "recognized",
        text: result.data.text,
        confidence: result.data.confidence,
      }),
    );
  } catch {
    self.postMessage({ kind: "unavailable" });
  } finally {
    await engine?.terminate();
  }
});

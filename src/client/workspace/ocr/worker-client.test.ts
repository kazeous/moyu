import { expect, it, vi } from "vitest";
import { createOcrClient } from "./worker-client";

function fixture() {
  const listeners = new Map<string, (event: { data?: unknown }) => void>();
  const port = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
  };
  const client = createOcrClient(() => port as unknown as Worker, 50);
  const input = {
    image: new Blob(["png"], { type: "image/png" }),
    language: "jpn" as const,
  };
  return {
    client,
    port,
    input,
    emit: (data: unknown) => listeners.get("message")?.({ data }),
  };
}

it("cancels the worker and ignores late OCR output", async () => {
  const { client, port, input, emit } = fixture();
  const result = client.recognize(input, () => {});
  client.cancel();
  emit({ kind: "recognized", text: "stale", confidence: 99 });
  expect(await result).toEqual({ kind: "cancelled" });
  expect(port.terminate).toHaveBeenCalledOnce();
});

it("reports invalid responses and stalled workers as retryable unavailability", async () => {
  const { client, input, emit } = fixture();
  const result = client.recognize(input, () => {});
  emit({ kind: "recognized", text: "private", confidence: 900 });
  expect(await result).toEqual({ kind: "unavailable" });
  expect(await client.recognize(input, () => {})).toEqual({
    kind: "unavailable",
  });
});

it("forwards only validated progress and OCR output and releases the worker", async () => {
  const { client, input, emit, port } = fixture();
  const progress = vi.fn();
  const result = client.recognize(input, progress);
  emit({ kind: "progress", progress: 0.5 });
  emit({ kind: "recognized", text: "  原文\r\n", confidence: 43 });
  expect(progress).toHaveBeenCalledWith(0.5);
  expect(await result).toEqual({
    kind: "recognized",
    text: "  原文\r\n",
    confidence: 43,
  });
  expect(port.terminate).toHaveBeenCalledOnce();
});

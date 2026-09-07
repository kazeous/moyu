import { expect, it, vi } from "vitest";
import {
  createLexicalWorkerClient,
  type LexicalWorkerPort,
} from "./worker-client";

function fixture() {
  const listeners = new Map<string, (event: MessageEvent | Event) => void>();
  const port = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn((type, fn) => listeners.set(type, fn)),
    removeEventListener: vi.fn((type) => listeners.delete(type)),
  } as unknown as LexicalWorkerPort;
  return {
    port,
    emit: (data: unknown) =>
      listeners.get("message")?.(new MessageEvent("message", { data })),
    fail: () =>
      listeners.get("error")?.(new Event("error", { cancelable: true })),
  };
}
const request = (id: string) => ({
  kind: "analyze" as const,
  id,
  source: "猫",
  language: "ja" as const,
  phrases: [],
  workTagIds: [],
});
const load = (id: string) => ({
  kind: "load" as const,
  id,
  language: "ja" as const,
  download: false,
});
const loaded = (id: string) => ({
  kind: "loaded",
  id,
  sources: [],
  installedIds: [],
  unavailableIds: [],
  updateIds: [],
  downloadBytes: 0,
  cacheAvailable: true,
});

it("requires loading again after an idle worker loses its dictionary index", async () => {
  const firstWorker = fixture();
  const retryWorker = fixture();
  const factory = vi
    .fn()
    .mockReturnValueOnce(firstWorker.port)
    .mockReturnValue(retryWorker.port);
  const client = createLexicalWorkerClient(factory);
  try {
    const initial = client.request(load("initial"));
    firstWorker.emit(loaded("initial"));
    await initial;
    firstWorker.fail();
    const nextLine = client.request(request("next-line"));
    expect(retryWorker.port.postMessage).not.toHaveBeenCalled();
    await expect(nextLine).resolves.toMatchObject({
      kind: "unavailable",
      reason: "worker",
      retryable: true,
    });
    const retry = client.request(load("reload"));
    retryWorker.emit(loaded("reload"));
    await retry;
    const analysis = client.request(request("restored"));
    expect(retryWorker.port.postMessage).toHaveBeenLastCalledWith(
      request("restored"),
    );
    retryWorker.emit({
      kind: "unavailable",
      id: "restored",
      reason: "assets",
      retryable: true,
    });
    await analysis;
  } finally {
    client.dispose();
  }
});

it("constructs a fresh worker after a fatal module load failure", async () => {
  const firstWorker = fixture();
  const retryWorker = fixture();
  const factory = vi
    .fn()
    .mockReturnValueOnce(firstWorker.port)
    .mockReturnValue(retryWorker.port);
  const client = createLexicalWorkerClient(factory);
  const initial = client.request(request("failed"));
  firstWorker.fail();
  await expect(initial).resolves.toMatchObject({ reason: "worker" });
  const retry = client.request(load("retry"));
  expect(factory).toHaveBeenCalledTimes(2);
  retryWorker.emit({
    kind: "unavailable",
    id: "retry",
    reason: "assets",
    retryable: true,
  });
  await expect(retry).resolves.toMatchObject({ id: "retry", reason: "assets" });
  client.dispose();
});

it("supersedes old analyses and ignores their late responses", async () => {
  const worker = fixture();
  const client = createLexicalWorkerClient(() => worker.port);
  const old = client.request(request("old"));
  const latest = client.request(request("new"));
  await expect(old).resolves.toEqual({ kind: "superseded", id: "old" });
  worker.emit({
    kind: "unavailable",
    id: "old",
    reason: "assets",
    retryable: true,
  });
  worker.emit({
    kind: "unavailable",
    id: "new",
    reason: "assets",
    retryable: true,
  });
  await expect(latest).resolves.toMatchObject({ id: "new", reason: "assets" });
  client.dispose();
});

it("rejects fabricated or incomplete source spans from a worker", async () => {
  const worker = fixture();
  const client = createLexicalWorkerClient(() => worker.port);
  const result = client.request(request("one"));
  worker.emit({
    kind: "analyzed",
    id: "one",
    analysis: {
      language: "ja",
      method: "dictionary-longest-match",
      tokens: [],
      alternatives: [],
    },
    overlays: [],
  });
  await expect(result).resolves.toMatchObject({
    kind: "unavailable",
    reason: "invalid",
  });
  client.dispose();
});

it("settles pending work on failure, disposal, and timeout without leaking source text", async () => {
  vi.useFakeTimers();
  const worker = fixture();
  const client = createLexicalWorkerClient(() => worker.port, 20);
  const first = client.request(request("one"));
  worker.fail();
  await expect(first).resolves.toMatchObject({ reason: "worker" });
  const second = client.request(load("two"));
  await vi.advanceTimersByTimeAsync(21);
  await expect(second).resolves.toMatchObject({ reason: "timeout" });
  const third = client.request(load("three"));
  client.dispose();
  await expect(third).resolves.toMatchObject({ kind: "disposed" });
  expect(worker.port.terminate).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

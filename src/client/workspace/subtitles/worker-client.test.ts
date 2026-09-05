import { describe, expect, it } from "vitest";
import type {
  ProcessSubtitleRequest,
  SubtitleWorkerResponse,
} from "./contracts";
import { createSubtitleWorkerClient } from "./worker-client";

type MessageListener = (event: MessageEvent<unknown>) => void;
type FailureListener = (event: Event) => void;

class FakeWorker {
  readonly posts: Array<{ message: unknown; transfer: Transferable[] }> = [];
  terminated = false;
  throwOnPost = false;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly errorListeners = new Set<FailureListener>();
  private readonly messageErrorListeners = new Set<FailureListener>();

  postMessage(message: unknown, transfer: Transferable[] = []) {
    if (this.throwOnPost) throw new Error("private postMessage failure");
    this.posts.push({ message, transfer });
  }

  addEventListener(type: "message", listener: MessageListener): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: FailureListener,
  ): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: MessageListener | FailureListener,
  ) {
    if (type === "message")
      this.messageListeners.add(listener as MessageListener);
    if (type === "error") this.errorListeners.add(listener as FailureListener);
    if (type === "messageerror")
      this.messageErrorListeners.add(listener as FailureListener);
  }

  removeEventListener(type: "message", listener: MessageListener): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: FailureListener,
  ): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: MessageListener | FailureListener,
  ) {
    if (type === "message")
      this.messageListeners.delete(listener as MessageListener);
    if (type === "error")
      this.errorListeners.delete(listener as FailureListener);
    if (type === "messageerror")
      this.messageErrorListeners.delete(listener as FailureListener);
  }

  terminate() {
    this.terminated = true;
  }

  respond(message: unknown) {
    for (const listener of this.messageListeners) {
      listener({ data: message } as MessageEvent<unknown>);
    }
  }

  fail(type: "error" | "messageerror") {
    const listeners =
      type === "error" ? this.errorListeners : this.messageErrorListeners;
    for (const listener of listeners) {
      listener({ privateMessage: "do not expose this" } as unknown as Event);
    }
  }

  listenerCount(type: "message" | "error" | "messageerror") {
    return (
      type === "message"
        ? this.messageListeners
        : type === "error"
          ? this.errorListeners
          : this.messageErrorListeners
    ).size;
  }
}

function request(operationId: string): ProcessSubtitleRequest {
  return {
    version: 1,
    operationId,
    source: {
      artifactId: `${operationId}-source`,
      format: "srt",
      encoding: "utf-8",
      bytes: new TextEncoder().encode("source").buffer,
    },
    reference: {
      artifactId: `${operationId}-reference`,
      format: "srt",
      encoding: "utf-8",
      bytes: new TextEncoder().encode("reference").buffer,
    },
    sourceLanguage: "zh",
    referenceLanguage: "vi",
  };
}

function response(
  operationId: string,
): Extract<SubtitleWorkerResponse, { kind: "processed" }> {
  return {
    version: 1,
    operationId,
    kind: "processed",
    draft: {
      version: 1,
      id: operationId,
      sourceArtifactId: `${operationId}-source`,
      referenceArtifactId: `${operationId}-reference`,
      sourceLanguage: "zh",
      referenceLanguage: "vi",
      sourceCues: [
        {
          id: `${operationId}-source:cue:0`,
          artifactId: `${operationId}-source`,
          sourceOrder: 0,
          startMs: 0,
          endMs: 1000,
          rawPayload: "source",
          visibleText: "source",
          warnings: [],
        },
      ],
      referenceCues: [
        {
          id: `${operationId}-reference:cue:0`,
          artifactId: `${operationId}-reference`,
          sourceOrder: 0,
          startMs: 0,
          endMs: 1000,
          rawPayload: "reference",
          visibleText: "reference",
          warnings: [],
        },
      ],
      groups: [
        {
          id: "group-1",
          sourceCueIds: [`${operationId}-source:cue:0`],
          referenceCueIds: [`${operationId}-reference:cue:0`],
          status: "confident",
          confidence: 100,
          decision: "automatic",
        },
      ],
      unassignedReferenceCueIds: [],
      ignoredReferenceCueIds: [],
      activeGroupId: "group-1",
      blockingFailures: [],
    },
  };
}

describe("createSubtitleWorkerClient", () => {
  it("transfers file buffers and suppresses an older result", async () => {
    const fake = new FakeWorker();
    const client = createSubtitleWorkerClient(() => fake);
    const old = client.process(request("old"));
    const current = client.process(request("current"));

    expect(fake.posts[0]?.transfer).toEqual(
      expect.arrayContaining([expect.any(ArrayBuffer)]),
    );
    expect(fake.posts[0]?.transfer).toHaveLength(2);
    fake.respond(response("old"));
    fake.respond(response("current"));

    await expect(old).resolves.toEqual({
      kind: "superseded",
      operationId: "old",
    });
    await expect(current).resolves.toMatchObject({
      kind: "processed",
      operationId: "current",
    });
  });

  it("settles pending work and dispose terminates the worker", async () => {
    const fake = new FakeWorker();
    const client = createSubtitleWorkerClient(() => fake);
    const pending = client.process(request("one"));
    fake.respond(response("one"));

    await expect(client.settle()).resolves.toBeUndefined();
    await pending;
    client.dispose();

    expect(fake.terminated).toBe(true);
  });

  it("keeps malformed worker failures content-free", async () => {
    const fake = new FakeWorker();
    const client = createSubtitleWorkerClient(() => fake);
    const pending = client.process(request("one"));
    fake.respond({
      version: 1,
      operationId: "one",
      privateText: "do not expose this",
    });

    await expect(pending).resolves.toMatchObject({
      kind: "processing-error",
      operationId: "one",
      code: "invalid-worker-message",
    });
    await expect(pending).resolves.not.toHaveProperty("privateText");
  });

  it("ignores a malformed late response for a superseded operation", async () => {
    const fake = new FakeWorker();
    const client = createSubtitleWorkerClient(() => fake);
    const old = client.process(request("old"));
    const current = client.process(request("current"));

    fake.respond({ version: 1, operationId: "old", kind: "processed" });
    await expect(old).resolves.toEqual({
      kind: "superseded",
      operationId: "old",
    });
    fake.respond(response("current"));

    await expect(current).resolves.toMatchObject({
      kind: "processed",
      operationId: "current",
    });
  });

  it("ignores a response for an unknown operation", async () => {
    const fake = new FakeWorker();
    const client = createSubtitleWorkerClient(() => fake);
    const pending = client.process(request("current"));

    fake.respond(response("unknown"));
    fake.respond(response("current"));

    await expect(pending).resolves.toMatchObject({
      kind: "processed",
      operationId: "current",
    });
  });

  it("settles only the matching operation for malformed worker output", async () => {
    const fake = new FakeWorker();
    const client = createSubtitleWorkerClient(() => fake);
    const pending = client.process(request("current"));

    fake.respond({ version: 1, operationId: "current", kind: "processed" });

    await expect(pending).resolves.toMatchObject({
      kind: "processing-error",
      operationId: "current",
      code: "invalid-worker-message",
    });
  });

  it.each(["error", "messageerror"] as const)(
    "settles pending work after a worker %s event",
    async (type) => {
      const fake = new FakeWorker();
      const client = createSubtitleWorkerClient(() => fake);
      const pending = client.process(request("current"));

      fake.fail(type);

      await expect(pending).resolves.toMatchObject({
        kind: "processing-error",
        operationId: "current",
        code: "unexpected-error",
        retryable: true,
      });
      await expect(client.settle()).resolves.toBeUndefined();
    },
  );

  it("removes every worker listener on dispose", () => {
    const fake = new FakeWorker();
    const client = createSubtitleWorkerClient(() => fake);

    client.dispose();

    expect(fake.listenerCount("message")).toBe(0);
    expect(fake.listenerCount("error")).toBe(0);
    expect(fake.listenerCount("messageerror")).toBe(0);
  });

  it("settles a synchronous postMessage failure without exposing its error", async () => {
    const fake = new FakeWorker();
    fake.throwOnPost = true;
    const client = createSubtitleWorkerClient(() => fake);

    const result = await client.process(request("current"));

    expect(result).toMatchObject({
      kind: "processing-error",
      operationId: "current",
      code: "unexpected-error",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("private postMessage failure");
    await expect(client.settle()).resolves.toBeUndefined();
  });

  it("rejects a schema-valid response that fails cue conservation", async () => {
    const fake = new FakeWorker();
    const client = createSubtitleWorkerClient(() => fake);
    const pending = client.process(request("current"));
    const valid = response("current");

    fake.respond({
      ...valid,
      draft: {
        ...valid.draft,
        groups: [
          {
            ...valid.draft.groups[0],
            sourceCueIds: ["missing-source-cue"],
          },
        ],
      },
    });

    await expect(pending).resolves.toMatchObject({
      kind: "processing-error",
      operationId: "current",
      code: "invalid-worker-message",
    });
  });
});

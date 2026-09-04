import { describe, expect, it } from "vitest";
import type {
  ProcessSubtitleRequest,
  SubtitleWorkerResponse,
} from "./contracts";
import { createSubtitleWorkerClient } from "./worker-client";

type MessageListener = (event: MessageEvent<unknown>) => void;

class FakeWorker {
  readonly posts: Array<{ message: unknown; transfer: Transferable[] }> = [];
  terminated = false;
  private readonly listeners = new Set<MessageListener>();

  postMessage(message: unknown, transfer: Transferable[] = []) {
    this.posts.push({ message, transfer });
  }

  addEventListener(type: "message", listener: MessageListener) {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type: "message", listener: MessageListener) {
    if (type === "message") this.listeners.delete(listener);
  }

  terminate() {
    this.terminated = true;
  }

  respond(message: unknown) {
    for (const listener of this.listeners) {
      listener({ data: message } as MessageEvent<unknown>);
    }
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

function response(operationId: string): SubtitleWorkerResponse {
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
    fake.respond({ operationId: "one", privateText: "do not expose this" });

    await expect(pending).resolves.toMatchObject({
      kind: "processing-error",
      operationId: "one",
      code: "invalid-worker-message",
    });
    await expect(pending).resolves.not.toHaveProperty("privateText");
  });
});

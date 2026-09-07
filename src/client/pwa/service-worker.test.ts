import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

async function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const cache = { match: vi.fn(), put: vi.fn(), addAll: vi.fn() };
  const network = vi.fn(async () => new Response("public"));
  const scope = {
    __MOYU_PRECACHE: [
      "/offline.html",
      "/_next/static/app.js",
      "/_next/static/chunks/turbopack-worker-test.js",
    ],
    __MOYU_OCR: ["/ocr/v1/lang/jpn.traineddata.gz"],
    __MOYU_VERSION: "test",
    location: { origin: "https://moyu.test" },
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      handlers.set(name, callback),
    caches: {
      open: vi.fn(async () => cache),
      keys: vi.fn(async () => []),
      delete: vi.fn(),
    },
    fetch: network,
    clients: { claim: vi.fn() },
    URL,
    Headers,
    Response,
    Request,
  };
  runInNewContext(
    await readFile("src/client/pwa/service-worker.js", "utf8"),
    scope,
  );
  return { handlers, cache, network };
}

it("never intercepts API, auth, non-GET, cross-origin or query-bearing asset requests", async () => {
  const { handlers, network } = await worker();
  for (const [url, method] of [
    ["/api/me/phrases", "GET"],
    ["/sign-in", "GET"],
    ["/api/auth/sign-in", "POST"],
    ["/workspace?private=secret", "GET"],
    ["/_next/static/app.js?private=secret", "GET"],
    ["https://other.test/_next/static/app.js", "GET"],
  ]) {
    const respondWith = vi.fn();
    handlers.get("fetch")!({
      request: new Request(new URL(url!, "https://moyu.test"), { method }),
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  }
  expect(network).not.toHaveBeenCalled();
});

it("serves the public workspace shell offline and caches only listed assets", async () => {
  const { handlers, cache, network } = await worker();
  network.mockRejectedValue(new Error("offline"));
  cache.match.mockResolvedValue(new Response("offline workspace"));
  let response: Promise<Response> | undefined;
  handlers.get("fetch")!({
    request: {
      url: "https://moyu.test/workspace",
      method: "GET",
      mode: "navigate",
    },
    respondWith: (result: Promise<Response>) => {
      response = result;
    },
  });
  expect(await (await response)!.text()).toBe("offline workspace");
  expect(cache.match).toHaveBeenCalledWith("/offline.html");
  expect(cache.put).not.toHaveBeenCalled();
});

it("keeps the original worker URL when returning a cached script", async () => {
  const { handlers, cache } = await worker();
  const cached = new Response("worker code", {
    headers: {
      "Content-Type": "text/javascript",
      "Content-Encoding": "gzip",
      "Content-Length": "42",
    },
  });
  Object.defineProperty(cached, "url", {
    value: "https://moyu.test/_next/static/chunks/turbopack-worker-test.js",
  });
  cache.match.mockResolvedValue(cached);
  let response: Promise<Response> | undefined;
  handlers.get("fetch")!({
    request: new Request(
      "https://moyu.test/_next/static/chunks/turbopack-worker-test.js",
    ),
    respondWith: (result: Promise<Response>) => {
      response = result;
    },
  });
  const delivered = (await response)!;
  expect(delivered.url).toBe("");
  expect(delivered.headers.get("Content-Type")).toBe("text/javascript");
  expect(delivered.headers.has("Content-Encoding")).toBe(false);
  expect(delivered.headers.has("Content-Length")).toBe(false);
  expect(await delivered.text()).toBe("worker code");
});

it("preserves response identity for ordinary imported scripts", async () => {
  const { handlers, cache } = await worker();
  const cached = new Response("imported script");
  cache.match.mockResolvedValue(cached);
  let response: Promise<Response> | undefined;
  handlers.get("fetch")!({
    request: new Request("https://moyu.test/_next/static/app.js"),
    respondWith: (result: Promise<Response>) => {
      response = result;
    },
  });
  expect(await response).toBe(cached);
});

it("restores the public shell when the host is temporarily unavailable", async () => {
  const { handlers, cache, network } = await worker();
  network.mockResolvedValue(new Response("unavailable", { status: 503 }));
  cache.match.mockResolvedValue(new Response("local workspace"));
  let response: Promise<Response> | undefined;
  handlers.get("fetch")!({
    request: {
      url: "https://moyu.test/workspace",
      method: "GET",
      mode: "navigate",
    },
    respondWith: (result: Promise<Response>) => {
      response = result;
    },
  });
  expect(await (await response)!.text()).toBe("local workspace");
});

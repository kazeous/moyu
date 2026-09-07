// Injected by scripts/build-pwa.mjs from the production build, never user data.
const scope = globalThis;
const shellCache = `moyu-shell-${scope.__MOYU_VERSION}`;
const assetCache = "moyu-ocr-v1";
const precache = new Set(scope.__MOYU_PRECACHE);
const ocrAssets = new Set(scope.__MOYU_OCR);

function assetResponse(response, pathname) {
  if (!pathname.includes("/turbopack-worker-") || response.status !== 200)
    return response;
  // Preserve native response metadata for ordinary imported scripts. Rewriting
  // their response identity can strand nested worker imports in WebKit.
  // Keep the requesting worker's URL, including Turbopack's bootstrap fragment.
  // A cached Response.url otherwise replaces it with the fragment-free cache URL.
  const headers = new scope.Headers(response.headers);
  // Cache bodies are already decoded; these transport headers describe the
  // compressed network bytes, not the synthetic script response.
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  return new scope.Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

scope.addEventListener("install", (event) => {
  event.waitUntil(
    scope.caches.open(shellCache).then((cache) => cache.addAll([...precache])),
  );
  // Updates wait until all existing tabs close. Never replace a running workspace.
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await scope.caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("moyu-shell-") && key !== shellCache)
          .map((key) => scope.caches.delete(key)),
      );
      await scope.clients.claim();
    })(),
  );
});

scope.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new scope.URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== scope.location.origin ||
    url.search
  )
    return;
  if (request.mode === "navigate" && url.pathname === "/workspace") {
    event.respondWith(
      (async () => {
        try {
          const response = await scope.fetch(request);
          if (response.status < 500) return response;
        } catch {
          /* A network outage uses the same public shell. */
        }
        const cache = await scope.caches.open(shellCache);
        return (
          (await cache.match("/offline.html")) ??
          new scope.Response(
            "Open moyu online once to prepare offline review.",
            { status: 503 },
          )
        );
      })(),
    );
    return;
  }
  const name = precache.has(url.pathname)
    ? shellCache
    : ocrAssets.has(url.pathname)
      ? assetCache
      : null;
  if (!name) return;
  event.respondWith(
    (async () => {
      const cache = await scope.caches.open(name);
      const cached = await cache.match(url.pathname);
      if (cached) return assetResponse(cached, url.pathname);
      const response = await scope.fetch(url.href, {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
      if (response.ok && !response.redirected && response.type !== "opaque") {
        // Cache exhaustion must not turn a successful asset load into a failure.
        await cache.put(url.pathname, response.clone()).catch(() => {});
      }
      return assetResponse(response, url.pathname);
    })(),
  );
});

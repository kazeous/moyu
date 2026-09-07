import { cp } from "node:fs/promises";
import { createServer, request as forward } from "node:http";
import { spawn } from "node:child_process";
import process from "node:process";

// Exercise the same standalone artifact as Docker through a host-outage proxy.
// Use an HTTP failure rather than reset sockets: WebKit's test network process
// can abort unrelated blob/worker loads after a reset. Chromium and Firefox also
// run with browser networking disabled; WebKit uses the unavailable host.
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
await cp("public", ".next/standalone/public", { recursive: true });
const app = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: { ...process.env, PORT: "3104", HOSTNAME: "127.0.0.1" },
});
let offline = false;
const proxy = createServer((incoming, outgoing) => {
  if (offline) {
    outgoing.writeHead(503, { "Cache-Control": "no-store" });
    outgoing.end();
    return;
  }
  const upstream = forward(
    {
      hostname: "127.0.0.1",
      port: 3104,
      path: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.on("error", () => {
    outgoing.writeHead(503);
    outgoing.end();
  });
  incoming.pipe(upstream);
});
const control = createServer((request, response) => {
  if (
    request.method === "POST" &&
    ["/offline", "/online"].includes(request.url)
  ) {
    offline = request.url === "/offline";
    response.writeHead(204);
    response.end();
  } else {
    response.writeHead(404);
    response.end();
  }
});
proxy.listen(3100, "127.0.0.1");
control.listen(3105, "127.0.0.1");
function stop() {
  app.kill();
  proxy.close();
  control.close();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
app.on("exit", () => {
  proxy.close();
  control.close();
});

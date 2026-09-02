import { createServer } from "node:http";
import { URL } from "node:url";
import { SMTPServer } from "smtp-server";

// Test-only transport; binds loopback, accepts only reserved synthetic recipients.
const messages = new Map();
const smtp = new SMTPServer({
  disabledCommands: ["STARTTLS"],
  onAuth(_auth, _session, callback) {
    callback(null, { user: "test" });
  },
  onRcptTo(address, _session, callback) {
    callback(
      address.address.endsWith("@example.test")
        ? undefined
        : new Error("Synthetic recipients only"),
    );
  },
  onData(stream, session, callback) {
    let content = "";
    stream.on("data", (chunk) => {
      content += chunk.toString();
    });
    stream.on("end", () => {
      for (const recipient of session.envelope.rcptTo)
        messages.set(recipient.address, content);
      callback();
    });
  },
  logger: false,
});
smtp.listen(3103, "127.0.0.1");
createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:3102");
  response.setHeader("Content-Type", "application/json");
  if (url.pathname === "/health") return response.end("{}");
  const email = url.searchParams.get("email");
  const message = messages.get(email) ?? null;
  messages.delete(email);
  response.end(JSON.stringify({ message }));
}).listen(3102, "127.0.0.1");

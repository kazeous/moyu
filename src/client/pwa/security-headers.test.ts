import { expect, it } from "vitest";
import config from "../../../next.config";

it("restricts workspace connections and executable assets to the app origin", async () => {
  const headers = await config.headers!();
  const policy = headers
    .find((rule) => rule.source === "/:path*")
    ?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("worker-src 'self' blob:");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("form-action 'self'");
});

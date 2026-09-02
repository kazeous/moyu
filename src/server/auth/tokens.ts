import { createHash, randomBytes } from "node:crypto";

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function isValidToken(rawToken: string): boolean {
  return (
    typeof rawToken === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(rawToken) &&
    Buffer.from(rawToken, "base64url").toString("base64url") === rawToken
  );
}

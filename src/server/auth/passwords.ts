import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP's 128 MiB scrypt setting; allow headroom for Node's working memory.
const parameters = { N: 131_072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const encodedHashPattern =
  /^scrypt\$v1\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;

function validPassword(plainText: string): boolean {
  return (
    typeof plainText === "string" &&
    Buffer.byteLength(plainText, "utf8") > 0 &&
    Buffer.byteLength(plainText, "utf8") <= 1024
  );
}

function deriveKey(plainText: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plainText, salt, 64, parameters, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(plainText: string): Promise<string> {
  if (!validPassword(plainText)) {
    throw new Error("Password must be between 1 and 1024 UTF-8 bytes");
  }

  const salt = randomBytes(16);
  const key = await deriveKey(plainText, salt);
  return `scrypt$v1$${parameters.N}$${parameters.r}$${parameters.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(
  plainText: string,
  encoded: string,
): Promise<boolean> {
  if (
    !validPassword(plainText) ||
    typeof encoded !== "string" ||
    encoded.length > 256
  )
    return false;
  // Only the supported, bounded parameter set may trigger expensive work.
  const match = encodedHashPattern.exec(encoded);
  if (!match) return false;

  const key = await deriveKey(plainText, Buffer.from(match[1], "hex"));
  return timingSafeEqual(key, Buffer.from(match[2], "hex"));
}

import { createHash } from "node:crypto";
import { HttpError } from "./response";

type Options = {
  ipLimit: number;
  emailLimit: number;
  capacity: number;
  windowMs: number;
  now?: () => number;
};

export function createAuthLimiter({
  ipLimit,
  emailLimit,
  capacity,
  windowMs,
  now = Date.now,
}: Options) {
  const buckets = new Map<string, { count: number; expires: number }>();
  function consume(keys: [string, number][]): boolean {
    const time = now();
    for (const [key, entry] of buckets)
      if (entry.expires <= time) buckets.delete(key);
    const missing = keys.filter(([key]) => !buckets.has(key)).length;
    if (
      buckets.size + missing > capacity ||
      keys.some(([key, limit]) => (buckets.get(key)?.count ?? 0) >= limit)
    )
      return false;
    for (const [key] of keys) {
      const entry = buckets.get(key) ?? { count: 0, expires: time + windowMs };
      entry.count++;
      buckets.set(key, entry);
    }
    return true;
  }
  const emailKey = (email: string) =>
    `email:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
  return {
    allow: (ip: string, email?: string) =>
      consume([
        [`ip:${ip}`, ipLimit],
        ...(email ? [[emailKey(email), emailLimit] as [string, number]] : []),
      ]),
    allowEmail: (email: string) => consume([[emailKey(email), emailLimit]]),
  };
}

export function createConcurrencyGate(maximum: number) {
  let active = 0;
  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (active >= maximum)
        throw new HttpError(429, "Too many attempts. Try again later.");
      active++;
      try {
        return await operation();
      } finally {
        active--;
      }
    },
  };
}

// Single-process limits survive route-module duplication/HMR. Restart resets them;
// multiple replicas require a shared limiter at ingress before scaling out.
const state = globalThis as typeof globalThis & {
  moyuAuthLimiter?: ReturnType<typeof createAuthLimiter>;
  moyuPasswordGate?: ReturnType<typeof createConcurrencyGate>;
};
export const authLimiter = (state.moyuAuthLimiter ??= createAuthLimiter({
  ipLimit: 60,
  emailLimit: 6,
  capacity: 10_000,
  windowMs: 15 * 60 * 1000,
}));
// Each active scrypt operation uses about 128 MiB; no unbounded waiting queue.
export const passwordGate = (state.moyuPasswordGate ??=
  createConcurrencyGate(2));

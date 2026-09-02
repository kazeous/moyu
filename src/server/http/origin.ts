import { isIP } from "node:net";

export function hasValidOrigin(request: Request, appOrigin: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return (
      origin === new URL(origin).origin && origin === new URL(appOrigin).origin
    );
  } catch {
    return false;
  }
}

/** TRUST_PROXY requires ingress to overwrite X-Forwarded-For with ONE client IP.
 * Next Request exposes no socket peer, so an untrusted/missing header shares a bucket.
 * Never enable this on a directly reachable application port.
 */
export function clientIp(request: Request, trustProxy: boolean): string {
  const forwarded = request.headers.get("x-forwarded-for")?.trim();
  return trustProxy && forwarded && isIP(forwarded) ? forwarded : "shared";
}

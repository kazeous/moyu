import { MetadataConflictError } from "@/server/metadata-conflict";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleRequest(
  operation: () => Promise<Response>,
): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof MetadataConflictError
          ? 409
          : 503;
    const message =
      error instanceof HttpError || error instanceof MetadataConflictError
        ? error.message
        : "Service unavailable. Try again later.";
    const response = jsonResponse({ error: message }, status);
    if (status === 429) response.headers.set("Retry-After", "900");
    return response;
  }
}

export const SESSION_COOKIE_NAME = "moyu_session";
export function sessionCookie(
  rawToken: string,
  expiresAt: Date,
  production = process.env.NODE_ENV === "production",
): string {
  return `${SESSION_COOKIE_NAME}=${rawToken}; Path=/; Expires=${expiresAt.toUTCString()}; HttpOnly; SameSite=Lax${production ? "; Secure" : ""}`;
}

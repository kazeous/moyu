# moyu coding-agent instructions

## Read first

1. Read the local design specification at `docs/superpowers/specs/2026-09-02-moyu-design.md`.
2. Read the relevant local implementation plan in `docs/superpowers/plans/` before changing code.
3. `docs/` is intentionally local-only and ignored by Git. Do not add, remove, or force-add its contents unless the user explicitly asks.

## Product constraints

- moyu is a hosted PWA for Japanese/Chinese dialogue review with English/Vietnamese references.
- Imported dialogue, translations, images, OCR text, tokenization, lookup results, and selection history are browser-only. Never add these to an API payload, database schema, logs, analytics event, server action, error report, or telemetry.
- The server stores only authentication data, personal work tags, personal custom phrases/glosses, and non-dialogue user settings.
- Every server query and mutation for tags, phrases, glosses, and settings must enforce the authenticated owner identifier. Client-side hiding is not access control.
- There are no shared phrase libraries, collaboration features, remote AI calls, or online translation fallback in the MVP.

## Engineering conventions

- Use TypeScript with strict type checking. Validate every external boundary with Zod or an equivalently explicit schema.
- Keep server code in `src/server/`, browser-only code in `src/client/`, and route handlers thin. Do not import browser APIs from server code or server secrets from client code.
- Give each module one purpose. Prefer small named functions and exported types over large mixed-responsibility files.
- Preserve original source text exactly; normalized text, tokens, OCR output, and phrase overlays are derived data.
- Return explicit unknown, ambiguous, unavailable, and retryable states. Never fabricate dictionary evidence or silently discard imported text.
- Use Web Workers for OCR, tokenization, indexing, and other expensive browser work.

## Security and operations

- Production requires HTTPS, secure HTTP-only auth cookies, salted adaptive password hashing, one-time short-lived hashed magic-link tokens, CSRF/origin checks, and rate limits for login and magic-link endpoints.
- Keep request bodies out of production logs. Secrets belong only in environment variables and must never be committed.
- Every deployable change must retain ARM-compatible Docker builds, a non-sensitive health endpoint, and PostgreSQL migration readiness.

## Delivery discipline

- Use test-driven development: write the failing focused test, run it, make the smallest implementation pass, then run the relevant suite.
- Run formatting, linting, type checking, unit tests, and the relevant browser/integration tests before reporting success.
- Make small focused commits. Do not refactor unrelated code or overwrite existing user work.
- Stop and ask for direction if a requested feature conflicts with the privacy contract or requires sending review content to a third party.

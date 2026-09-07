# moyu

moyu is a hosted Japanese/Chinese dialogue review app with English/Vietnamese references. It implements accounts, password and email magic-link sign-in, private work tags, phrases/glosses and settings, plus a browser-only dialogue workspace with paste and subtitle-file import. OCR, lexical processing and a fully installable/offline PWA shell are subsequent work.

Imported dialogue, reference translations, subtitle file names and bytes, all derived subtitle data (including decoded text, parsed cues, speaker names, timing data, warnings and alignment decisions), images, OCR, tokenization, lookup results and selection history belong only in the browser. They must never enter API payloads, server actions, PostgreSQL, logs, analytics, telemetry or error reports. The server stores authentication and personal terminology/settings metadata only; every metadata operation enforces the authenticated owner.

## Local development

Use Node.js 24+, Corepack with the pinned pnpm 10, Docker Compose and PostgreSQL 16. Run commands from the repository root. Commands below use PowerShell; equivalent environment exports work in other shells.

```powershell
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose -f compose.dev.yml up -d --wait
corepack pnpm db:migrate
corepack pnpm dev
```

The Compose project defaults to `moyu-foundation`; PostgreSQL listens on `127.0.0.1:5432` with database/user/password `moyu` for local use only. The app runs at `http://localhost:3000`. `.env` is ignored; replace its auth secret. `db:migrate` reads `.env`, applies committed migrations and checks their complete hash/timestamp ledger. It is safe to repeat. `db:generate` generates migrations after an intentional schema change; review and commit their SQL, journal and snapshot before deploying. Migration SQL is LF in every checkout because Drizzle hashes its exact bytes. Never edit an already applied migration.

The example SMTP settings are development placeholders. Password sign-in works without sending mail; magic links need a configured SMTP server. The browser test harness starts its own local capture server and uses only reserved `example.test` recipients. It does not contact an external email provider.

## Browser-only dialogue review

Open `/workspace` (or follow **Open workspace** from `/`) and choose either paste or **Upload subtitle files**.

Paste accepts Japanese or Chinese dialogue as source-only text or alternating source/reference pairs. Correct the proposed Japanese/Chinese plus English/Vietnamese pairing before starting review.

Subtitle import requires one Japanese or Chinese source `.srt` or `.ass` file and accepts an optional English or Vietnamese reference `.srt` or `.ass` file. Source and reference formats are independent, so mixed `.srt`/`.ass` imports work. Each file may be at most 25 MiB; moyu imposes no cue-count limit. A UTF-8, UTF-16LE or UTF-16BE BOM selects the corresponding decoder. Without a BOM, decoding is strict UTF-8. If that fails, choose Shift-JIS, GB18030 or Big5 manually for the affected file; moyu does not guess a legacy encoding or replace invalid bytes silently.

Files are decoded and parsed in a browser worker, then aligned locally by timestamps. The alignment preview is mandatory even for a source-only import. Accept or correct ambiguous groups, attach unmatched cues or choose **Keep source-only**, and attach or explicitly ignore each unassigned reference before review can start. Confident groups need no extra confirmation. ASS `Name` or `Actor` values remain browser-local metadata; **Show speaker names** controls source and reference labels during alignment and source speaker labels in review without deleting that metadata.

IndexedDB in that browser stores the original pasted text or raw subtitle files, selected encodings, parsed cues and warnings, alignment decisions, active cue or line, evidence-panel width and speaker visibility preference. This lets an unfinished subtitle correction draft or active review resume after reload or browser restart on the same browser. Confirmed **Clear session** atomically removes the active review session, current subtitle draft and its referenced raw subtitle artifacts. It does not remove synced terminology/settings or the browser-local speaker visibility preference, and cleared review content cannot be restored from the server.

Once the workspace page and subtitle worker asset have loaded, subtitle files can be processed locally while the browser is offline. The complete installable/offline PWA shell is still future work, so offline navigation to the app or an offline reload is not supported by this release.

The workspace deliberately shows lexical evidence as unavailable until audited browser-local dictionaries and tokenizers are installed. It never invents readings, lemmas, parts of speech or definitions, and it has no translation or remote-AI fallback. Narrow layouts use a compact line navigator and bottom evidence sheet; desktop layouts keep the navigator, continuous review surface and a resizable evidence pane synchronized.

```powershell
corepack pnpm format
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
# Avoid conflicting inherited NO_COLOR and Playwright FORCE_COLOR flags.
Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
corepack pnpm test:e2e
corepack pnpm verify:workspace
corepack pnpm build
```

Unit/integration tests require the local database to be running and migrated. Readiness tests create and remove an isolated temporary database, so the local test role needs `CREATEDB`. Browser tests reserve app port `3000`, SMTP capture API `3102` and SMTP `3103`; stop any development server first. The production build follows browser tests because Next development regenerates its type paths.

## Runtime configuration

| Variable                     | Value/requirement                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                   | `production` in the release image.                                                                                                                                                                                                                                                                                        |
| `DATABASE_URL`               | PostgreSQL URL reachable from the application container; use the private database service hostname, credentials and database name.                                                                                                                                                                                        |
| `APP_ORIGIN`                 | Public HTTPS origin, for example `https://moyu.example.com`; production rejects HTTP. Use only the origin, without an application path.                                                                                                                                                                                   |
| `AUTH_COOKIE_SECRET`         | Required configuration secret, at least 32 characters; for example generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store in the deployment secret manager. Current sessions use opaque tokens with database hash lookup; rotating this setting alone does not revoke them. |
| `SMTP_HOST`, `SMTP_PORT`     | Provider hostname and port. Port 465 uses implicit TLS; other ports require STARTTLS in production, with certificate validation and TLS 1.2+.                                                                                                                                                                             |
| `SMTP_USER`, `SMTP_PASSWORD` | Required authenticated SMTP credentials.                                                                                                                                                                                                                                                                                  |
| `SMTP_FROM`                  | A valid sender address authorized by the provider.                                                                                                                                                                                                                                                                        |
| `TRUST_PROXY`                | `false` by default. Only set `true` when the trusted ingress overwrites `X-Forwarded-For` with exactly one validated client IP and the app port is private.                                                                                                                                                               |

With `TRUST_PROXY=false`, forwarded headers are ignored and clients share a conservative IP rate bucket. With `true`, address chains, malformed addresses and missing headers still use the shared bucket. Merely appending to a client-supplied header is unsafe: the ingress must replace it, and users must have no path to bypass the ingress and reach port 3000 directly.

Production cookies are Secure, HttpOnly and SameSite=Lax; mutations require the configured same origin. Sessions last 30 days. Magic links last 15 minutes, work once, require an existing account and are confirmed by POST after opening a fragment-token URL. Do not log request bodies, credentials, tokens, cookies, review content or full email messages at the app, proxy or SMTP layer.

This release is for a **single application instance**. The in-memory login/registration/magic-link limiter permits 60 attempts per IP and 6 per normalized email per 15 minutes, with at most 10,000 buckets. Restarts reset these quotas, and replicas do not share them. Add shared ingress/distributed rate limiting before scaling out. Password hashing admits only two simultaneous scrypt operations without a queue: budget approximately 256 MiB of active scrypt working memory **plus** Next/Node runtime and database overhead; do not set a 256 MiB container limit.

## Coolify deployment

1. Create a private PostgreSQL 16 service and a repository application using the Dockerfile build pack, build context `/`, and `Dockerfile`. Build on ARM64 or with a builder that supports `linux/arm64`. Keep the database on the private network and back up account/terminology metadata.
2. Configure the variables above as runtime secrets/settings. Select one app instance. Route the desired domain through HTTPS with a valid certificate to container port `3000`; do not publish that port publicly. Configure ingress header overwrite before enabling `TRUST_PROXY`.
3. Build the image. The release includes the migration runner, production dependencies, and committed migration assets. Run exactly one pre-deployment migration job from the **new image**, on the database network with the same environment, before routing traffic to it:

   ```sh
   node scripts/migrate.mjs
   ```

   For a Docker one-off job: `docker run --rm --network YOUR_PRIVATE_NETWORK --env-file YOUR_RUNTIME_ENV moyu:foundation node scripts/migrate.mjs`. Do not run migrations concurrently from multiple replicas. Back up before upgrades; an app rollback must use a compatible database migration history.

4. Use `/api/health` as the Coolify health path on port `3000`. The image also includes a Docker health check. HTTP 200 is exactly `{"status":"ok","checks":{"database":"ok","migrations":"ok"}}` with `Cache-Control: no-store`. Unreachable databases, missing assets, and missing/outdated/altered/extra migration ledger entries produce 503 with non-sensitive failed/unavailable states. Health never returns a connection string, SQL, SMTP settings or secrets. It verifies the migration ledger, not a forensic audit of manually altered tables.
5. Before enabling traffic, check container startup, private health, the public HTTPS certificate/redirect, Secure/HttpOnly/SameSite cookie behavior, and the actual ingress IP overwrite. Verify all required SMTP settings are present without displaying credentials. Using an explicitly approved recipient, check provider authentication/TLS, sender authorization and magic-link delivery from the public origin.

No production VM, domain or SMTP provider is configured by this repository. Local ARM runtime validation and the production configuration checks do not prove a live HTTPS ingress or external mail delivery. Perform those target-specific checks during deployment; automated foundation tests never send external email.

## Release gate

`corepack pnpm verify:workspace` parses the actual client workspace, including subtitle modules and the subtitle worker, plus the server and API source trees. It rejects server imports of browser workspace modules, forbidden review/subtitle-content fields at API boundaries, workspace imports of server modules, and bare or qualified browser workspace use of `fetch`, `sendBeacon`, `EventSource`, `WebSocket` or `XMLHttpRequest`. It also reruns the exported metadata DTO privacy audit, workspace and subtitle unit tests, and workspace browser tests. Run it for every dialogue-workspace release in addition to the gates above.

`corepack pnpm verify:foundation` checks the **actual exported metadata DTO schemas recursively**, rejects forbidden review-content fields, parses a production HTTPS/auth/SMTP environment, validates generated SQL and the live database migration ledger, checks the live health response, then builds `moyu:foundation` for `linux/arm64` and inspects its actual architecture. It fails on any failed check; it does not generate/apply migrations, start an app or send mail for you. Docker must support ARM64 builds (native or emulated).

For local release validation, configure a separate ignored `.env.release` with the runtime variables, an HTTPS `APP_ORIGIN` such as `https://moyu.example.test`, and real local database credentials. Load it for commands below. SMTP may point to a local capture service because this check validates configuration only.

The complete release gate is formatting, linting, strict type checking, unit/integration tests, browser end-to-end tests, a production build, workspace privacy verification, foundation verification, a `linux/arm64` image build and architecture inspection, migration readiness, and the non-sensitive health check. Run all of these on the release commit; a partial run is not release readiness.

```powershell
# Load your ignored release configuration into this PowerShell session.
Get-Content .env.release | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  Set-Item "Env:$name" $value
}
corepack pnpm db:migrate
corepack pnpm format
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
corepack pnpm test:e2e
corepack pnpm verify:workspace
corepack pnpm build
docker build --platform linux/arm64 -t moyu:foundation .
docker image inspect moyu:foundation --format '{{.Os}}/{{.Architecture}}'
# Docker Desktop reaches the host database through host.docker.internal.
# On Linux, use the shared Compose network/private PostgreSQL service hostname.
docker run --rm --platform linux/arm64 --env-file .env.release `
  -e DATABASE_URL=postgresql://moyu:moyu@host.docker.internal:5432/moyu `
  moyu:foundation node scripts/migrate.mjs
docker run -d --name moyu-release-check --platform linux/arm64 `
  --env-file .env.release -p 127.0.0.1:3100:3000 `
  -e DATABASE_URL=postgresql://moyu:moyu@host.docker.internal:5432/moyu `
  moyu:foundation
$env:FOUNDATION_HEALTH_URL = 'http://127.0.0.1:3100/api/health'
curl.exe --fail --silent http://127.0.0.1:3100/api/health
corepack pnpm verify:foundation
docker inspect moyu-release-check --format '{{.State.Health.Status}}'
docker stop moyu-release-check
docker rm moyu-release-check
```

The explicit private health URL allows checking the local HTTP container behind the intended HTTPS ingress; the verifier still requires HTTPS in `APP_ORIGIN`. A production gate should omit the override to check the public HTTPS health endpoint. Run all formatting/lint/type/unit/database/browser/build gates above as well. Confirm the image migration command on a fresh disposable database and repeat it to establish idempotence before approving a release.

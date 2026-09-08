# moyu

moyu is a hosted Japanese/Chinese dialogue review app with English/Vietnamese references. It implements accounts, password and email magic-link sign-in, private work tags, phrases/glosses and settings, plus a browser-only dialogue workspace with paste, subtitle-file and image OCR import, local dictionary evidence and personal phrase overlays. Production builds provide an installable offline workspace.

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

Open `/workspace` (or follow **Open workspace** from `/`) and choose paste, **Upload subtitle files** or **Import image**.

Paste accepts Japanese or Chinese dialogue as source-only text or alternating source/reference pairs. Correct the proposed Japanese/Chinese plus English/Vietnamese pairing before starting review.

Subtitle import requires one Japanese or Chinese source `.srt` or `.ass` file and accepts an optional English or Vietnamese reference `.srt` or `.ass` file. Source and reference formats are independent, so mixed `.srt`/`.ass` imports work. Each file may be at most 25 MiB; moyu imposes no cue-count limit. A UTF-8, UTF-16LE or UTF-16BE BOM selects the corresponding decoder. Without a BOM, decoding is strict UTF-8. If that fails, choose Shift-JIS, GB18030 or Big5 manually for the affected file; moyu does not guess a legacy encoding or replace invalid bytes silently.

Files are decoded and parsed in a browser worker, then aligned locally by timestamps. The alignment preview is mandatory even for a source-only import. Accept or correct ambiguous groups, attach unmatched cues or choose **Keep source-only**, and attach or explicitly ignore each unassigned reference before review can start. Confident groups need no extra confirmation. ASS `Name` or `Actor` values remain browser-local metadata; **Show speaker names** controls source and reference labels during alignment and source speaker labels in review without deleting that metadata.

IndexedDB in that browser stores the original pasted text or raw subtitle files, selected encodings, parsed cues and warnings, alignment decisions, active cue or line, evidence-panel width and speaker visibility preference. This lets an unfinished subtitle correction draft or active review resume after reload or browser restart on the same browser. Confirmed **Clear session** atomically removes the active review session, current subtitle draft and its referenced raw subtitle artifacts. It does not remove synced terminology/settings or the browser-local speaker visibility preference, and cleared review content cannot be restored from the server.

Choose **Import image** to paste a clipboard image or select a PNG, JPEG, WebP or BMP file (up to 25 MiB and 24 megapixels for recognition). Choose Japanese, simplified Chinese or traditional Chinese and run **Recognize image**. Tesseract processes it in browser workers using versioned assets served from moyu; no remote recognition service is used. Correct the text, choose source-only or alternating reference pairing, then preview before starting review. Recognition can miss or misread text even at high confidence. Low confidence, empty output, cancellation, unavailable assets and failures retain the original image and offer retry/manual correction. Retrying recognition preserves manual corrections. **Resume image draft** restores unfinished correction; **Review image** reopens the original during review. IndexedDB v3 adds OCR storage without rewriting previous review data. Confirmed **Clear session** deletes all original images, OCR output and corrections together with the review and subtitle content.

Use **Install / offline** for readiness and installation guidance. After the production workspace finishes preparing online, `/workspace` opens and reloads offline with its existing local session. Installed dictionaries and previously used OCR models work offline; missing assets show a recoverable unavailable state. Install through a supporting browser's install menu, or Share → Add to Home Screen on iOS. Authentication and terminology sync require a connection; confirmed unsynced phrase edits remain available to retry. Updates wait until all moyu tabs close, preserving the running workspace. Browser storage remains local to that browser and can be removed by browser settings or storage eviction.

The service worker caches a public build-time workspace shell and explicitly listed static assets. It never caches API, account, sign-in or magic-link responses, mutations, cross-origin requests, or asset URLs containing query strings. OCR assets are cached on successful use, separately from review content. Development mode does not install a service worker. See [OCR provenance and rebuild instructions](public/ocr/README.md).

`test:pwa` verifies the standalone production artifact in Chromium, Firefox and WebKit, including cached dictionary and OCR worker restarts. Chromium and Firefox run with browser networking disabled. WebKit uses a proxy returning HTTP 503 for every request: headless offline emulation and connection resets can abort local worker/blob loads before cache handling in this test environment. It reserves ports 3100, 3104 and 3105; the outage proxy exists only in the test harness. For a clean browser environment, run `docker build -f Dockerfile.browser-tests -t moyu:browser-tests .` then `docker run --rm --ipc=host moyu:browser-tests`. The image version matches the locked Playwright runner; update both together. Host antivirus/browser extensions can inject traffic or modify model responses and invalidate host-side privacy results. The container gate keeps those assertions intact. Physical iOS/Android installation and airplane-mode behavior still require device testing.

Choose **Install dictionaries** in Evidence to download the source language's English and Vietnamese packs (about 12.1 MiB for Japanese or 10.4 MiB for Chinese). SHA256-verified compressed packs are cached in IndexedDB. Indexing, segmentation, lookups and exact phrase matching run in a browser worker; requests use fixed public asset paths and never contain review text. Cached dictionaries work without network once the workspace is loaded. A newly published manifest offers **Update dictionaries** while the previous installed versions remain usable; failed downloads or storage writes preserve that fallback. Storage failure permits a current-visit download and explicitly warns that it may not survive reload.

Select individual tokens, Shift-select another token, or use **Extend selection** to select an adjacent range on touch devices. Original source spans, including whitespace and composed characters, remain unchanged. The selected range and active work-tag IDs stay in the local session. Evidence shows sourced dictionary forms, readings, parts of speech and language-labeled definitions, with per-entry attribution and alternate boundaries. Segmentation uses longest dictionary matches with locale-aware fallback, not grammatical or contextual disambiguation. Inflected forms absent from the dictionaries remain unknown; missing readings or English/Vietnamese definitions remain explicit. Vietnamese coverage is substantially smaller. No reading, definition or translation is fabricated, and there is no remote lookup or AI fallback.

**Load personal library** explicitly retrieves only the signed-in account's metadata. Select work tags locally, select a source phrase, supply English and/or Vietnamese glosses and choose **Save personal phrase** to sync that confirmed metadata. Matching phrases appear as preferred overlays; raw tokens and general dictionary evidence remain inspectable. Confirmed unsynced edits are kept in a separate owner-bound IndexedDB queue. Retry uses the same UUID and server-side idempotency, including after a lost response; account changes prevent a queued phrase from being sent under another owner. Clear session removes the local review and its selection, while generic dictionary packs and personal phrase metadata/unsynced edits remain. Narrow layouts use a bottom evidence sheet; desktop keeps the navigator, review and resizable evidence pane synchronized.

The release includes JMdict Japanese–English (324,695 spelling/reading records), CC-CEDICT Chinese–English (124,968 entries), and Vietnamese Wiktionary Japanese/Chinese extracts through Kaikki (11,164 / 5,110 records, including records without definitions). These are source records, not unique-word or complete-coverage counts. All derived packs are distributed under **CC BY-SA 4.0** with source notices and Wiktionary contributor credits in `public/lexical/`. See [the source register](public/lexical/manifest.json), [release provenance](public/lexical/release.json) and [rebuild instructions](scripts/lexical/README.md). JMdict requires regular updates: the deployment maintainer must rebuild at least monthly, next by **2026-10-05** for this release. Application code is separate from the dictionary data license.

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
corepack pnpm test:pwa
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

Use the [MVP release checklist](RELEASE-CHECKLIST.md) to record automated, production and physical iOS/Android validation separately.

`corepack pnpm verify:workspace` parses the actual workspace, lexical and terminology production modules plus the server/API source trees. It rejects server imports of browser domains, forbidden review/subtitle-content fields at API boundaries, browser imports of server modules and unreviewed client helpers, and networking outside the named public-asset and metadata adapters. The adapters cannot import review session/engine modules. Unit tests verify strict metadata serialization and constant asset requests; browser tests inspect requests during import, analysis and explicit phrase saves. `corepack pnpm verify:lexical` runs the privacy check plus the lexical/terminology tests and real-dictionary browser flows, including a 384 MiB JavaScript-heap limit. This tests Chromium under a constrained heap; it is not a substitute for physical iOS/Android compatibility testing in the hardening phase.

The Python source-normalizer and full shipped-asset integrity checks run separately with `python -m unittest discover -s scripts/lexical -p "test_*.py"` (Python 3.12+). Run them when changing provider data or normalization. No runtime Python dependency is needed; the Docker image serves the committed public packs and notices.

`corepack pnpm verify:foundation` checks the **actual exported metadata DTO schemas recursively**, rejects forbidden review-content fields, parses a production HTTPS/auth/SMTP environment, validates generated SQL and the live database migration ledger, checks the live health response, then builds `moyu:foundation` for `linux/arm64` and inspects its actual architecture. It fails on any failed check; it does not generate/apply migrations, start an app or send mail for you. Docker must support ARM64 builds (native or emulated).

For local release validation, configure a separate ignored `.env.release` with the runtime variables, an HTTPS `APP_ORIGIN` such as `https://moyu.example.test`, and real local database credentials. Load it for commands below. SMTP may point to a local capture service because this check validates configuration only.

The complete release gate is formatting, linting, strict type checking, unit/integration tests, browser end-to-end tests, a production build, production offline/install tests in Chromium, Firefox and WebKit, workspace privacy verification, foundation verification, a `linux/arm64` image build and architecture inspection, migration readiness, and the non-sensitive health check. Run all of these on the release commit; a partial run is not release readiness.

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
corepack pnpm test:pwa
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

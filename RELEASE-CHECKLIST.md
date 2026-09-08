# MVP release checklist

Use this checklist with the [release commands and runtime requirements](README.md#release-gate). Record the tested commit, image digest, date and observed result. A checked local gate does not prove a production or physical-device gate.

## Build and automated checks

- [ ] Record the release commit and confirm the worktree has only intended changes.
- [ ] Formatting, lint, strict type checking and all unit/integration tests pass.
- [ ] Browser end-to-end tests pass with the local SMTP capture service.
- [ ] Workspace privacy verification passes.
- [ ] Production build and isolated Chromium, Firefox and WebKit PWA tests pass.
- [ ] ARM64 image builds; inspect `linux/arm64` and record its digest.
- [ ] Run the new image's migration command on a fresh disposable database, repeat it, and verify health and migration readiness.
- [ ] Foundation verification passes with the intended production environment contract.

On Windows, `.gitattributes` keeps text checkouts in LF even when Git has `core.autocrlf=true`; binary files remain unchanged. Do not change already applied migration SQL.

## Production target

- [ ] Record the Coolify application, domain, configured branch and deployed commit/image.
- [ ] Confirm private PostgreSQL, a single app instance, and a current backup with a tested restore procedure.
- [ ] Confirm [runtime settings](README.md#runtime-configuration) without copying credentials into the checklist or logs.
- [ ] Confirm migrations from the new image finish before routing traffic; do not run concurrent migration jobs.
- [ ] Confirm public HTTPS certificate validation and HTTP-to-HTTPS redirect.
- [ ] Confirm `/api/health` returns HTTP 200, `Cache-Control: no-store` and exactly `{"status":"ok","checks":{"database":"ok","migrations":"ok"}}`.
- [ ] Confirm the app's container port and database are private. Leave `TRUST_PROXY=false` unless ingress IP overwrite has been verified.
- [ ] With a designated test account, verify Secure, HttpOnly and SameSite=Lax session cookies, logout and owner isolation.
- [ ] With an explicitly approved recipient, verify SMTP TLS, authorized sender, delivery and one-time magic-link confirmation at the public origin.
- [ ] Record the previous compatible app image and rollback procedure. A rollback must preserve compatibility with the applied migration history.

Use a separate browser profile for synthetic review tests. Tabs in the same profile share IndexedDB; opening another tab does not isolate an existing review session.

## Physical iOS and Android

Run each item on both an iPhone/iPad with Safari and an Android device with Chrome. Record device model, OS version, browser version, tested commit and pass/fail notes using synthetic content only.

- [ ] Open the HTTPS workspace, wait for offline readiness and install from the browser's supported install flow.
- [ ] Launch from the home screen and verify a standalone workspace opens.
- [ ] Paste Japanese and Chinese samples with English/Vietnamese references; correct pairs and start review.
- [ ] Import a synthetic SRT/ASS pair, correct an ambiguous alignment, reload and resume the draft.
- [ ] Install Japanese and Chinese dictionaries; select tokens and extend selection by touch. Verify attribution and explicit unavailable/unknown results.
- [ ] Recognize a Japanese image first. Edit, retry and resume an unfinished correction after closing the app; leave the Chinese OCR models uncached for the next checks.
- [ ] Enable airplane mode with Wi-Fi also off. Relaunch and reload; verify the saved review, installed dictionaries and previously used OCR models work.
- [ ] Request simplified Chinese OCR offline before using that model online; verify a recoverable unavailable state preserves the original image and manual edits. Reconnect, recognize simplified and traditional Chinese images, then repeat the offline reload checks with all three cached languages.
- [ ] Check portrait/landscape rotation, the on-screen keyboard, evidence sheet, scrolling and text selection without hidden controls or lost work.
- [ ] Reconnect and verify explicit metadata sync retries; review text and images must never be included in requests.
- [ ] During a controlled update, verify open tabs keep working; close all app tabs/windows, reopen and confirm local review restoration on the new version.
- [ ] After the update check and confirming the synthetic session is disposable, clear it, reopen the app and verify review text, subtitle drafts and image artifacts are gone.

Headless WebKit is not physical iOS Safari. The automated WebKit outage test uses HTTP 503 responses; it does not certify airplane-mode behavior on a device.

## Result record

| Gate                               | Commit/image | Environment and date | Result/evidence |
| ---------------------------------- | ------------ | -------------------- | --------------- |
| Automated checks                   |              |                      |                 |
| ARM runtime and migrations         |              |                      |                 |
| Production deployment and health   |              |                      |                 |
| Production authentication and mail |              |                      |                 |
| iOS installation and offline       |              |                      |                 |
| Android installation and offline   |              |                      |                 |

Mark a release accepted only when the required rows have observed passing results. Keep unresolved checks explicit; do not infer them from another environment.

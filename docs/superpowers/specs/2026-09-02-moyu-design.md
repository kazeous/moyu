# moyu design specification

**Status:** Accepted for implementation planning  
**Date:** 2026-09-02

## Product

moyu is a hosted, installable web application for reviewing Japanese and Chinese dialogue translations into English or Vietnamese. It gives an editor attributable word- and phrase-level evidence so they can identify omissions, additions, or inaccurate interpretation in supplied subtitle/localization translations.

moyu is not a general translation chat product. Segmentation, dictionary evidence, and the editor's private terminology are the default workflow. AI and online translation assistance are explicitly outside the MVP and require a separate future design.

The application is hosted on an ARM VM through Coolify so users can continue work from any machine. Imported dialogue and images remain in the browser on the machine where they were pasted.

## Goals and non-goals

### Goals

- Accept Japanese or Chinese source dialogue with optional English or Vietnamese reference translations.
- Show segmentation, readings, part-of-speech information, definitions, attribution, and explicit unknown or ambiguous states.
- Support a fast review loop with an arbitrary number of visible and loaded dialogue lines.
- Give each user a personal library of work-tagged custom phrases and English/Vietnamese glosses.
- Accept clipboard images, OCR them locally, and make the result editable before import.
- Preserve the local active review session until the user explicitly clears it.

### MVP non-goals

- Automatic translation, LLM chat, automatic remote AI calls, and online lookup fallback.
- Shared phrase libraries, collaboration, teams, or project sharing.
- Syncing dialogue, translations, images, OCR, or analysis across devices.
- Aegisub integration, global hotkeys, subtitle rewriting, local LLMs, or a Windows-native wrapper.

## Privacy and data residency

### Server data

The server stores only:

- User accounts, password credentials, sessions, and magic-link verification records.
- Personal work tags.
- Personal custom phrases, English and/or Vietnamese glosses, notes, and tag assignments.
- Personal non-dialogue settings.

The server must never accept, store, log, index, or analyze source dialogue, target translations, pasted images, OCR text, tokenization output, or selection history. API schemas exclude those fields, and automated request-inspection tests enforce this boundary.

### Browser data

IndexedDB holds all active-review data: source and target lines, original clipboard images, OCR output, import edits, analysis, dictionary cache, phrase overlays, current selection, and local panel dimensions. This survives reload and browser restart on that browser. **Clear session** deletes this IndexedDB data only; it never deletes the synced terminology library or settings.

## Architecture

| Component | Responsibility |
| --- | --- |
| TypeScript PWA | Review UI, local session store, import flow, private metadata client, and installation/offline shell. |
| ARM Docker application | Auth, private metadata API, static-asset serving, health endpoints; deployed through Coolify. |
| PostgreSQL | Accounts, auth records, work tags, custom phrases, phrase glosses, and settings only. |
| Transactional email adapter | Sends magic links through the configured SMTP-compatible provider. |
| Versioned lexical assets | Client-downloaded tokenizer/dictionary data with source and license metadata. |
| Browser Web Workers | OCR, Japanese segmentation, Chinese segmentation, indexing, and expensive local processing. |

```text
paste text or image
  -> local browser session
  -> OCR or tokenizer worker
  -> lexical lookup + personal phrase overlay
  -> review workspace

sign in or edit phrase/settings
  -> authenticated metadata API
  -> PostgreSQL
```

The paths never merge: review content is not sent to the metadata API.

All production traffic uses HTTPS. Auth uses secure HTTP-only cookies, salted adaptive password hashes, short-lived single-use hashed magic-link tokens, CSRF protection, and rate limits on login and magic-link requests.

## Accounts and personal terminology

Accounts authenticate with email/password or a magic link. Every phrase library is private; there are no shared or public phrase records in the MVP.

| Entity | Key fields | Access rule |
| --- | --- | --- |
| User | id, email, display name | Authenticated owner only. |
| Credential | user id, password hash | Authentication service only. |
| Session / verification record | user id or email, token hash, expiry, use state | Authentication service only. |
| WorkTag | owner id, name, aliases | Owner only. |
| CustomPhrase | owner id, language, source phrase, note, matching mode | Owner only. |
| PhraseGloss | phrase id, `en` or `vi`, text | Owner only through phrase ownership. |
| PhraseTag | phrase id, tag id | Owner only through related records. |
| UserSetting | owner id, non-dialogue preferences | Owner only. |

The server applies ownership filters to every read and mutation; the UI is not the access-control boundary.

## Import and active session

### Text

Paste accepts one or many lines. moyu first preserves every pasted line and previews a suggested mode: source-only, alternating source/target, or manually corrected pairing. Alternating detection is only a suggestion; the user confirms or fixes pairing before import. Target/reference lines may be English or Vietnamese.

### Image OCR

Clipboard-image OCR runs in a browser worker; normal file selection is the fallback. The source image and output stay local. OCR text is always editable before import. Failure or uncertainty preserves the image locally and offers retry/manual correction rather than silently creating dialogue entries.

### Clearing

**Clear session** requires confirmation, removes local review data including images and cached analysis, and leaves account metadata intact. moyu does not automatically expire a review session and cannot restore a cleared one from the server.

## Review workspace

The desktop view has three coordinated panes.

### Mini navigator

The left pane lists compact source previews and current position. It follows the relative scroll position of the centre pane. Selecting an item smoothly scrolls its central entry into view and activates it. It is a navigator, not a fixed-size list of open dialogue.

### Central review surface

The centre pane contains the whole imported source/target set in one continuous, scrollable review surface. There is no maximum number of lines that may be imported, loaded, or compared. Rendering may be virtualized only if it preserves this continuous model.

Every entry shows source and an optional English/Vietnamese reference. Selecting a line makes it the single active analysis target: the selected line highlights, expands its selectable token/phrase chips, updates the evidence pane, and updates the mini navigator. Non-active entries stay visible as compact comparison context. Arrow Up and Arrow Down move the active line when focus is within the review workspace.

### Evidence pane

The right pane shows selected-token/phrase evidence: surface form, lemma, reading/pronunciation, part of speech, senses, provider attribution, and personal phrase matches. A drag divider resizes it and local storage restores its size on that device. On narrow screens, it becomes a lower drawer rather than compressing source text beyond readability.

Unknown tokens, competing segmentations, missing readings, and unavailable definitions are explicit states. moyu must never invent a definition for a missing entry.

## Lexical processing and phrases

Japanese and Chinese adapters implement a shared analysis contract: original spans, normalized lookup keys, available readings, part of speech, certainty, and available alternate boundaries. Imported source text is immutable.

Dictionary providers normalize licensed sources into a common entry model. Every entry displays source attribution. The released provider set must cover the English and Vietnamese review directions of this product; an entry available in only one language is labeled as such and is not machine-translated.

No lexical asset may ship until a source register records the source, data version, redistribution terms, attribution, update requirements, and asset size. Scraping or redistributing a source without explicit permission is prohibited.

To create a phrase, a user selects adjacent active-line tokens and supplies source language, one or both English/Vietnamese glosses, optional note, and one or more personal work tags. The phrase syncs to that user's library. Exact future matches under a matching tag appear as a preferred overlay while keeping raw tokens and generic dictionary evidence available to inspect.

## Resilience

| Situation | Behavior |
| --- | --- |
| Clipboard access unavailable | Use regular paste or file selection. |
| OCR failure or low confidence | Retain image locally; show retry and editable correction. |
| Unknown or ambiguous token | Preserve raw span and state ambiguity; do not fabricate evidence. |
| Dictionary asset unavailable | Preserve session and show a recoverable unavailable state. |
| Offline browser | Existing local session and cached assets work; auth and phrase sync wait for network. |
| Metadata sync failure | Retain the unsynced local phrase edit, mark it, and retry safely. |
| Clear session | Confirm and erase local review content only. |

## Acceptance criteria

1. Users can register via email/password and sign in through password or magic link.
2. API and UI tests prove one user cannot read or mutate another user's tags, phrases, or settings.
3. A private phrase syncs across devices logged into the same account.
4. Active dialogue remains local across reload/browser restart, then disappears only after **Clear session**.
5. Import supports source-only and user-confirmed alternating Japanese/Chinese plus English/Vietnamese pairing.
6. Clipboard-image OCR is editable before import; network assertions prove images and OCR text never reach the server.
7. The central review surface accepts an arbitrary line count and retains multiple visible comparison lines.
8. Active-line selection updates the highlight, token breakdown, mini navigator, and evidence pane; only the active line expands.
9. Central scrolling synchronizes the mini navigator; selecting the navigator scrolls and activates the matching entry.
10. Evidence width is draggable and restored locally.
11. Both language adapters return explicit unknown/ambiguous states rather than fabricated lexical output.
12. Production health checks cover container startup, database connectivity, migration readiness, HTTPS, email configuration visibility, and a non-sensitive health endpoint.

Testing includes unit tests for import parsing, phrase matching, local storage, authorization, and provider normalization; browser integration tests for import, session, and OCR; multi-account end-to-end tests; and request-inspection tests for the privacy contract.

## Delivery sequence

1. **Platform and accounts:** ARM container, PostgreSQL, email/password plus magic-link auth, private metadata API, isolation tests, and Coolify health checks.
2. **Terminology and privacy boundary:** work tags, phrases/glosses, settings sync, IndexedDB session store, Clear session, and review-content network tests.
3. **Text workspace:** paste import, pair correction, unbounded central review, synchronized navigator, active selection, Arrow navigation, and resizable evidence.
4. **Lexical processing:** source register, attribution UI, Japanese/Chinese adapters, dictionary assets, phrase overlays, and ambiguity states.
5. **OCR and hardening:** clipboard OCR, editable correction, worker performance, PWA offline/install behavior, compatibility verification, and end-to-end privacy tests.
6. **Later, separately designed:** consented online lookup or AI assistance that identifies the external provider immediately before sending text.

## Deployment and operations

Coolify deploys the ARM Docker application and PostgreSQL on the VM. Environment configuration holds database connection data, application origin, auth secrets, and SMTP credentials; no secrets are committed. Database backups cover only account metadata and terminology, never browser-local review sessions. Operational logs exclude request bodies and must never be used to capture active-session content.

# Playback Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show what other account devices are playing and offer explicit same-file continuation on the phone without automatic playback takeover.

**Architecture:** Add a validated 90-second in-memory presence catalog to the single billing process, exposed through authorized HTTP and the existing V2 socket. A shared client reporter covers TV snapshots and embedded phone playback; a self-contained mobile settings component polls only while visible and starts continuation through existing library/player actions.

**Tech Stack:** Node.js 24, Preact, TypeScript, PostgreSQL only for existing auth, Vitest; no new dependency or presence table.

**Spec:** `docs/superpowers/specs/2026-11-21-playback-presence-design.md`

## Global Constraints

- Presence contains no stream URL, magnet, token or server credential and never writes heartbeat to Postgres.
- Reporting/polling interval is 15 seconds, TTL is 90 seconds, and `sessionSeq` is a monotonic positive safe integer per device.
- Existing `/v1/presence` analytics, local phone-TV remote, sync records and HTTP response contracts do not change.
- No automatic play/pause, session takeover, desktop reporting, client V2 migration, beta or production deploy in this plan.
- Offline/reporting failure never interrupts local playback. Self presence is hidden; multiple other devices receive separate cards.
- All confirmed review and Greptile findings must be fixed.

## Review Focus

- A delayed lower `sessionSeq`, stale timer or expired 90-second record must not replace newer playback state.
- Revoked, read-only, wrong-device and cross-account callers must not read or mutate presence.
- Phone elapsed-time estimates must be bounded by duration and replaced by actual final progress without blocking playback.
- Continue must resolve the exact hash and fileId or explain why it cannot; it must never launch an arbitrary file.
- Hidden/unmounted settings must stop polling; self and multiple-device filtering must remain deterministic.

### Task 1: Presence validation and memory catalog

**Files:**
- Create: `ops/billing/src/playbackPresence.mjs`
- Test: `ops/billing/test/playbackPresence.test.ts`

**Interfaces:**
- `parsePresenceInput(raw): PresenceInput | { error: 'bad_presence' }`.
- `createPresenceStore(now = Date.now, ttlMs = 90000)` returns `put(accountId, deviceId, input)`, `clear(accountId, deviceId)`, `list(accountId)` and `subscribe(listener): () => void`.
- Stored rows include server-controlled `deviceId` and `updatedAt`; listeners receive `(accountId, presences)` after put/clear, not after rejected stale input.

- [ ] Write failing tests for every field bound, spoofed deviceId removal, invalid hash/file/numbers/platform, TTL deletion, clear, account isolation, playing-first ordering and monotonic `sessionSeq` rejection.
- [ ] Run `node node_modules/vitest/vitest.mjs run --config ops/billing/vitest.config.ts ops/billing/test/playbackPresence.test.ts` and verify RED on the missing module.
- [ ] Implement the sanitizer and catalog with per-account/per-device maps, stale-session no-op, pruning on access and synchronous isolated listeners.
- [ ] Re-run the focused suite and verify GREEN.
- [ ] Commit `feat: добавить память playback presence`.

### Task 2: Authorized HTTP and WebSocket presence

**Files:**
- Modify: `ops/billing/src/server.mjs`
- Modify: `ops/billing/src/syncSocket.mjs`
- Test: `ops/billing/test/syncSocketHttp.test.ts`
- Test: `ops/billing/test/syncSocket.test.ts`

**Interfaces:**
- `GET/POST /v2/sync/presence` use `authorizeSync`; POST accepts `{ presence: PresenceInput | null }` and both return `{ ok, presences, serverTime }`.
- `createSyncSocket` optionally accepts `presence: { list(accountId), put(accountId, deviceId, input), clear(accountId, deviceId), subscribe(listener) }` and handles client `presence` plus server `{ type: 'presence', presences, serverTime }`.
- Read-only GET is allowed; read-only POST/WS mutation is rejected. All socket presence delivery follows fresh authorization and account filtering.

- [ ] Write failing HTTP integration tests for PUT/clear/list, self deviceId stamping, invalid body 400, bad token 401, subscription denial, cross-account isolation and read-only POST 503.
- [ ] Write failing real-socket tests for presence update/broadcast, clear, stale session no-op and revoked-device close without a presence payload.
- [ ] Implement one catalog per app, HTTP routes and socket subscription/messages with bounded payload and no token/record logging. Keep old socket behavior when the optional dependency is absent.
- [ ] Run syntax checks, local socket tests and the full PostgreSQL billing suite in CI; verify all old HTTP/WS contracts remain green.
- [ ] Commit `feat: открыть playback presence API`.

### Task 3: Shared reporter and playback sources

**Files:**
- Create: `src/billing/presenceClient.ts`
- Modify: `src/main.tsx`
- Modify: `mobile/src/main.tsx`
- Modify: `src/screens/Player.tsx`
- Modify: `mobile/src/watch.ts`
- Test: `tests/billing/presenceClient.test.ts`
- Test: `mobile/tests/watch.test.ts`

**Interfaces:**
- `PresenceReport = Omit<PresenceInput, 'sessionId' | 'sessionSeq'>`; `startPresenceReporting(source: () => PresenceReport | null, sessionKey: string): (final?: PresenceReport | null) => void` starts immediate and 15-second reports.
- `setPresenceContext(fn)` mirrors the billing device HTTP context; `sendPresence(input: PresenceInput | null): Promise<boolean>` performs one update/clear; `fetchPresence(): Promise<PlaybackPresence[]>` reads the catalog.
- Reporter adds fresh `sessionId/sessionSeq`, estimates only playing position from elapsed time, clamps it to known duration and stops its previous timer. Calling the returned stop with a final report sends that actual state; no argument clears presence.
- TV source maps `buildSnapshot` plus clean torrent/episode names. Embedded phone source starts before `play2160`, finishes with actual saved state and never reports external-player playback.

- [ ] Write failing tests for Android/native request context, unauthenticated/offline no-op, monotonic persisted sessionSeq, source replacement, timer cleanup, elapsed estimates, duration clamp, final actual state and failed requests not rejecting playback.
- [ ] Implement the reporter with existing billing session/device token helpers and local storage for the last sessionSeq; do not change `/v1/presence` analytics.
- [ ] Wire TV snapshot reporting and cleanup in `Player.tsx`; wire embedded 2160 start/final reporting in `watchOnPhone` without changing queue/season decisions.
- [ ] Run focused client tests, root build and mobile build; verify playback actions and existing phone bridge tests remain green.
- [ ] Commit `feat: сообщать playback presence с устройств`.

### Task 4: Presence cards, continuation and PR

**Files:**
- Create: `mobile/src/screens/PresenceCards.tsx`
- Modify: `mobile/src/screens/Settings.tsx`
- Modify: `src/i18n/*.ts`
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`
- Modify: `docs/superpowers/specs/2026-11-20-realtime-device-sync-design.md`
- Test: `mobile/tests/presenceCards.test.tsx`
- Test: `mobile/tests/settings.test.tsx`

**Interfaces:**
- `PresenceCards` fetches only while mounted, visible, sync-enabled and subscription-allowed; it renders sorted non-self rows with explicit continuation.
- `presenceTarget(row, library)` returns the exact torrent/file or null. `continuePresence(row)` uses existing `playOnPhone` with row hash, fileId, positionSec and durationSec.

- [ ] Write failing UI tests for self filtering, multiple playing/paused cards, exact target selection, missing hash/file, visible-only polling cleanup, no automatic playback and the continuation arguments.
- [ ] Implement cards with existing `m-set-*`, `m-btn`, `formatDuration` and toast/i18n primitives; add matching locale keys to every language and avoid new TV CSS.
- [ ] Render cards in the existing account sync block, update RU/EN changelog and mark the presence implementation status in the parent spec without claiming client V2 or beta.
- [ ] Run focused mobile tests, full root and billing suites, `npm run build`, `npm run build:mobile`, `git diff --check` and a phone UI screenshot.
- [ ] Commit `feat: показать playback presence на телефоне`.
- [ ] Request independent whole-branch review, fix every confirmed finding and all Greptile comments, open one PR and wait for green required checks. Do not merge, deploy or release automatically.

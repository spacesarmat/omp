# Realtime Sync WebSocket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated `/v2/sync/ws` connections with ordered resume, mutations, commit-time broadcasts and reconnect-safe HTTP-compatible semantics.

**Architecture:** Extend `createSyncV2Store` with post-commit change listeners, then attach a focused `ws` module to the existing Node HTTP server. Reuse the same device/subscription authorization and mutation service as HTTP `/v1` and `/v2`; buffer live changes during resume so reconnect cannot observe a gap or older page after a newer event.

**Tech Stack:** Node.js 24, `ws` 8, PostgreSQL 17, Vitest; no client migration in this plan.

**Spec:** `docs/superpowers/specs/2026-11-20-realtime-device-sync-design.md`

## Global Constraints

- Token is never accepted in the URL or written to logs. Before successful auth no account data is sent.
- Auth timeout is 5 seconds, heartbeat is 25 seconds, incoming messages are limited to 8 KiB and mutation batches to 200 records.
- HTTP `/v1/sync` and `/v2/sync` request and response contracts remain unchanged.
- Only committed changes are broadcast. A listener or socket failure cannot turn a committed mutation into an HTTP/WS failure.
- Resume uses server revisions and may return at most 500 records per page; live records arriving during a resume are buffered and emitted afterward in revision order.
- No presence, client `/v2` migration, production deploy or release in this plan.
- All Greptile findings must be evaluated and fixed before completion.

## Review Focus

- Unauthenticated, expired, wrong-device and cross-account connections must never receive records.
- A rollback, duplicate ack or throwing listener must not create a broadcast or lose the original committed ack.
- A live change arriving while the resume query is pending must follow, not precede, the historical page.
- Reconnecting and repeating a mutation must return the original ack without a second change.
- Slow or dead clients must be disconnected for later resume without blocking other devices; account/device limits must fail closed.

### Task 1: Commit-time change notifications

**Files:**
- Modify: `ops/billing/src/deviceSyncV2.mjs`
- Test: `ops/billing/test/deviceSyncV2.test.ts`

**Interfaces:**
- `createSyncV2Store(store).onChanges(listener): () => void`, where `listener(accountId, changes)` receives revision-ordered `SyncRecordV2[]` after commit.
- `mutate` keeps its existing ack and pull contracts.

- [ ] Write failing PostgreSQL tests proving one committed batch emits its winning records, a duplicate emits nothing, an expired mutation emits nothing, and a throwing listener does not change the successful ack.
- [ ] Run the focused billing test with PostgreSQL and verify the new assertions fail before implementation.
- [ ] Collect new changes inside the transaction, return them with the internal result, invoke listeners only after `withClient` commits, isolate listener exceptions and return an unsubscribe function.
- [ ] Re-run the focused test and the existing sync suite; verify repeat, LWW and legacy expiry behavior remain green.
- [ ] Commit `feat: публиковать sync изменения после commit`.

### Task 2: WebSocket protocol, resume and connection guards

**Files:**
- Create: `ops/billing/src/syncSocket.mjs`
- Modify: `ops/billing/package.json`
- Modify: `ops/billing/package-lock.json`
- Test: `ops/billing/test/syncSocket.test.ts`

**Interfaces:**
- `createSyncSocket({ authorize, seen, pull, mutate, onChanges, now?, authTimeoutMs?, heartbeatMs? })` returns `{ handleUpgrade(req, socket, head), close() }`.
- `authorize(token, deviceId)` resolves to `{ accountId }` or throws an error with `code`; `pull(accountId, since, 500)` and `mutate(accountId, deviceId, records, now)` are the existing V2 operations.
- Client messages: `auth { token, deviceId }`, `resume { since }`, `mutations { records }`, `ping`.
- Server messages: `ready`, `changes { records, nextRevision, serverTime }`, `ack { ack, serverTime }`, `pong`, `error { code }`.

- [ ] Add the pinned `ws` 8 runtime dependency through npm and lock it; do not add a browser client dependency.
- [ ] With a real local HTTP upgrade server and injected in-memory sync operations, write failing tests for auth timeout 5 s defaults, invalid auth close, ready, JSON ping/pong, mutations/ack, expired mutation error and unknown message handling.
- [ ] Write a controlled pending-pull test: revision 1 is historical, revision 2 is broadcast while resume is pending, and the client observes `changes` revisions 1 then 2 without a duplicate or reversal.
- [ ] Write tests for 8 KiB payload rejection, 200-record batch enforcement, 20 connections per account, 5 per device, 1 MB buffered-amount disconnect and heartbeat termination of an unresponsive client.
- [ ] Implement `createSyncSocket` with `WebSocketServer({ noServer: true, maxPayload: 8192 })`, per-socket auth timers, account/device registries, post-auth subscription filtering, resume buffering, safe sends and a 25 s ping sweep. Close slow clients with 1013 so reconnect can resume; never log tokens or record bodies.
- [ ] Run `node --check ops/billing/src/syncSocket.mjs` and the focused socket tests; verify all protocol and guard tests pass.
- [ ] Commit `feat: добавить WebSocket протокол sync v2`.

### Task 3: Billing integration, live compatibility and PR

**Files:**
- Modify: `ops/billing/src/server.mjs`
- Test: `ops/billing/test/syncSocketHttp.test.ts`
- Modify: `docs/superpowers/specs/2026-11-20-realtime-device-sync-design.md`
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`

**Interfaces:**
- Shared `authorizeSync(token, deviceId)` returns the linked account or the same HTTP-style status/error used by `/v1/sync` and `/v2/sync`.
- The app exposes `app.syncUpgrade(req, socket, head)` and `app.syncClose()`; `listen` attaches Upgrade and closes the socket hub with the HTTP server.

- [ ] Write failing PostgreSQL integration tests using real activated devices: valid auth/ready, 401/403-equivalent close behavior, HTTP `/v1` and `/v2` writes broadcast to both account devices, WS mutation reaches HTTP pull, another account receives nothing, and reconnect plus repeated mutation produces one change.
- [ ] Extract the existing sync authorization into one helper used by both HTTP routes and the socket callback; preserve every current HTTP status and response body.
- [ ] Create one socket hub per app, subscribe it to `syncV2Db.onChanges`, attach `server.on('upgrade', ...)` only for `/v2/sync/ws`, return 503 for unavailable storage and 404 for other upgrade paths, and close all clients during server shutdown.
- [ ] Run `node --check` for changed MJS, the complete billing suite with PostgreSQL, root build and `git diff --check`. Document that the existing Caddy reverse proxy forwards Upgrade without a config change.
- [ ] Add matching `[tech]` changelog entries describing server-only WebSocket, resume and unchanged HTTP fallback. Update the spec stage status without claiming client or production rollout.
- [ ] Commit `feat: подключить realtime sync к billing`.
- [ ] Request independent whole-branch review, fix every confirmed finding and all Greptile comments, open one PR and wait for green build, android, billing and desktop checks. Do not merge, deploy or release automatically.

# Client Sync V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate capable clients to durable revision/outbox synchronization with one device leader, realtime reconnect and safe HTTP/V1 fallback.

**Architecture:** Add an independent IndexedDB records/outbox/meta store while preserving the synchronous Bag as screen projection and V1 fallback. A lease leader owns transport; V2 HTTP handles recovery and WS handles realtime without duplicate in-flight mutations. Capability and server flags choose V2 conservatively.

**Tech Stack:** TypeScript, Preact, IndexedDB, native WebSocket, Vitest with `fake-indexeddb` as a dev-only test dependency; existing Node billing API.

**Spec:** `docs/superpowers/specs/2026-11-21-client-sync-v2-design.md`

## Global Constraints

- Current whole-record LWW, `/v1/progress`, local playback and `/v1` response behavior remain unchanged.
- Local record plus outbox mutation commit in one IDB transaction. Ack removes only its mutationId, never a newer edit of the same record.
- `omp.syncV2=off` always returns to V1; IDB mirroring continues and re-enable merges by LWW without overwriting a newer Bag.
- No token in WS URL, no automatic mutation_expired reapply, no poison-record FIFO block and no simultaneous HTTP+WS send of one mutation.
- No HLC, per-field merge, WS presence migration or production deploy in this implementation PR.
- Beta requires a later merged implementation, manual device stand and explicit release verification.

## Review Focus

- Crash/restart between projection and IDB work must recover unsent Bag edits without duplicate ack removal of newer mutations.
- Account switch, disabled flag and stale V1/V2 responses must never upload old-account rows or regress cursor/projection.
- Two tabs and stale lease holders must elect one transport leader without losing follower writes.
- Lost response, 409 expiry, rejected record and byte-limit overflow must preserve local data without infinite retry or duplicate application.
- WS close/token refresh/backpressure must fall back to HTTP V2 and resume from a monotonic revision.

### Task 1: Transactional V2 records, outbox and migration

**Files:**
- Create: `src/store/deviceV2Db.ts`
- Modify: `src/store/deviceDb.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/store/deviceV2Db.test.ts`
- Test: `tests/store/deviceDb.test.ts`

**Interfaces:**
- `SyncRecordV2 = SyncRecord & { mutationId?: string; revision?: number }`; `OutboxRow = { mutationId, accountId, row, createdAt, blocked? }`.
- `putV2Local(rows, accountId): Promise<OutboxRow[]>`, `mirrorV2Bag(rows): Promise<void>`, `enqueueUnsent(rows, accountId): Promise<void>`.
- `readV2Outbox(accountId, limit?): Promise<OutboxRow[]>`, `ackV2(acks, sentRows): Promise<void>`, `mergeV2Pulled(rows): Promise<SyncRecord[]>`.
- `readV2Meta(accountId)`, `writeV2Meta(accountId, patch)`, `hydrateV2Projection(currentRows): Promise<SyncRecord[]>`.

- [ ] Add pinned dev-only `fake-indexeddb` and write failing tests for atomic record+mutation, restart recovery, counter-based stable ids, selective ack, newer-edit survival, migration of only unsent rows, blocked-record replacement and LWW re-enable merge.
- [ ] Implement `omp-sync-v2` version 1 with records/outbox/meta and promise wrappers that reject transaction errors; never resolve before commit.
- [ ] Mirror every Bag write even with sync disabled and hydrate through `reapplyDeviceRecords` after merging current rows by LWW.
- [ ] Run focused storage tests and existing deviceDb tests; verify RED before implementation and GREEN afterward.
- [ ] Commit `feat: добавить transactional outbox sync v2`.

### Task 2: Capability, server kill-switch and device leader

**Files:**
- Create: `src/billing/syncV2Capabilities.ts`
- Create: `src/billing/syncLeader.ts`
- Modify: `ops/billing/src/server.mjs`
- Modify: `src/billing/session.ts`
- Modify: `src/sources/ompJackett.ts`
- Test: `tests/billing/syncV2Capabilities.test.ts`
- Test: `tests/billing/syncLeader.test.ts`
- Test: `ops/billing/test/deviceSync.test.ts`

**Interfaces:**
- `syncV2Mode(): 'auto' | 'on' | 'off'`, `setSyncV2Mode(mode)`, `canUseV2(account): Promise<boolean>`; server `sync.v2 === false` disables every mode. Auto and on require a real IDB transaction and WebSocket/lease capability; on only bypasses automatic cache expiry for explicit diagnostics.
- `createSyncLeader({ deviceId, isLeader, run, publish }): { start(), stop(), request(), isLeader() }` with 15 s lease TTL, 5 s refresh, BC or storage fallback.
- `/v1/me` adds `sync.v2` from `BILLING_SYNC_V2 !== '0'` without changing existing fields.

- [ ] Write failing tests for off/auto/on, server denial, actual transaction failure, unsupported WebSocket, leader/follower requests, stale lease takeover, pagehide release and storage-events fallback.
- [ ] Implement conservative capability caching per account/device and reset hooks for tests/account changes.
- [ ] Implement one lease owner and follower request forwarding without preventing local IDB writes.
- [ ] Add the server flag and `/v1/me` mapping with tests proving default on and env off; no admin or compose change.
- [ ] Run focused suites and billing `/v1/me` regression tests.
- [ ] Commit `feat: добавить capability и leader sync v2`.

### Task 3: HTTP V2 pump, recovery and V1 fallback

**Files:**
- Create: `src/billing/deviceSyncV2Client.ts`
- Modify: `src/billing/deviceSyncClient.ts`
- Modify: `src/billing/session.ts`
- Modify: `src/store/deviceV2Db.ts`
- Test: `tests/billing/deviceSyncV2Client.test.ts`
- Test: `tests/billing/deviceSyncClient.test.ts`

**Interfaces:**
- `runV2(owner, epoch, isOwner): Promise<'ok' | 'error' | 'offline' | 'denied' | 'v1'>`, sharing native/browser request context with V1.
- `acceptV2Page(answer)` atomically acks, merges records, advances revision, applies winning projection and updates legacy ackSent.
- Expired ids are dropped without re-enqueue and the rolled-back remainder retries; invalid/missing-ack entries become blocked and later entries continue.

- [ ] Write failing tests for stable mutation ids, lost response repeat, selective ack, 500-page resume, account switch mid-flight, offline no-V1-double-send, 404/405/503 V1 fallback, 409 recovery and poison-record quarantine.
- [ ] Implement the HTTP pump with 200-record chunks and existing device token handling; call V1 only for explicit capability/server fallback.
- [ ] Integrate `runDeviceSync` and scheduling without changing its public status contract; V2 ack also marks old sent bookkeeping.
- [ ] Run focused V1/V2 tests, storage tests and root build.
- [ ] Commit `feat: перевести sync клиента на HTTP v2`.

### Task 4: WebSocket realtime, status UI and PR

**Files:**
- Create: `src/billing/syncSocketClient.ts`
- Create: `src/billing/syncV2Status.ts`
- Modify: `src/billing/deviceSyncV2Client.ts`
- Modify: `src/billing/syncLeader.ts`
- Modify: `mobile/src/screens/Settings.tsx`
- Modify: `src/i18n/*.ts`
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.en.md`
- Test: `tests/billing/syncSocketClient.test.ts`
- Test: `mobile/tests/settings.test.tsx`

**Interfaces:**
- Socket client handles auth/ready/resume/changes/ack/error and byte-bounded mutations (at most 200 and 7500 serialized bytes before envelope).
- One mutation flight is marked in-flight until ack/error; HTTP fallback never sends the same ids concurrently.
- Status exposes `transport`, `pending`, `blocked`, `revision`, `lastAt` and `lastError`; Settings shows synchronized/offline queue state without technical detail outside test mode.

- [ ] Write failing tests for token-in-message auth, reconnect with 1-30 s exponential jitter, resume after disconnect, token rotation close, mutation byte chunking, ack timeout fallback and no duplicate HTTP+WS flight.
- [ ] Implement the leader-owned socket and HTTP fallback using Task 3 page/ack logic; followers receive status but never open sockets.
- [ ] Add pending/offline/synchronized status and matching locale keys; preserve manual sync and subscription denial behavior.
- [ ] Run full root and billing suites, builds, `git diff --check`, two-tab and offline integration scenarios in a real browser.
- [ ] Update RU/EN changelog and parent spec implementation status. Commit `feat: включить realtime sync v2 на клиентах`.
- [ ] Request independent whole-branch review, fix every confirmed finding and all Greptile comments, open one PR and wait for required checks. Do not merge, deploy or release automatically.

### Task 5: Device stand and beta, only after Task 4 is merged

- [ ] Deploy required billing changes with backup and verify health.
- [ ] Install the actual beta candidate on S21 with `adb install -r`; test LG, Android TV and desktop without clearing application data.
- [ ] Exercise offline queue, lock/unlock, process restart, two tabs, WS disconnect during batch, mutation retry, expired recovery, account switch and flag rollback. Record exact results before tagging.
- [ ] Run the established beta bump/PR workflow, wait for build/android/billing and Greptile, merge only with Andy's approval and publish the beta tag without a Telegram post.

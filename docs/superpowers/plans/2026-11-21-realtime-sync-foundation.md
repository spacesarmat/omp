# Realtime Sync Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent synced library metadata from being stranded after a cold start and prevent a delayed progress HTTP request from moving the same device backwards.

**Architecture:** Rebuild existing screen projections from the already persisted device records whenever the app starts and when the library arrives. Add an optional monotonic `writerSeq` to the existing `/v1/progress` protocol so new clients protect same-device writes while old clients keep their current behavior.

**Tech Stack:** TypeScript, Preact, IndexedDB/localStorage projections, Node.js, PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-realtime-device-sync-design.md`

## Global Constraints

- Preserve the current `/v1` clients and the current localStorage projections.
- Do not raise the supported webOS floor; client code remains Chromium 53 safe.
- Do not introduce playback sessions, WebSocket or `/v2` in this plan.
- A zero or absent `writerSeq` means a legacy writer and keeps the old acceptance behavior.
- No production deploy or NUC migration without separate approval.
- User-visible changes go under `Не выпущено` and `Unreleased` in both changelogs.

## Review Focus

- Cold start with records but an empty library: `tests/store/applyPulled.test.ts` must prove the later library projection is applied.
- Same-device responses arriving out of order: `ops/billing/test/progressRoute.test.ts` must prove the lower `writerSeq` cannot replace the higher one.
- Two devices saving concurrently: the other device must still be accepted by `ops/billing/test/progressRoute.test.ts`.
- Legacy clients with no `writerSeq`: the existing progress route test must remain green without changing its request bodies.
- Multiple writes in one millisecond and page reload: `tests/player/progressWriteSeq.test.ts` must prove the sequence stays monotonic.

---

### Task 1: Cold-start projection repair

**Files:**
- Modify: `src/store/applyPulled.ts`
- Modify: `src/main.tsx`
- Modify: `mobile/src/main.tsx`
- Test: `tests/store/applyPulled.test.ts`

**Interfaces:**
- Consumes: existing `deviceRecords(): SyncRecord[]` and `applyPulled(rows: SyncRecord[]): void`.
- Produces: `reapplyDeviceRecords(): void`, which applies the current persisted winners and parks library rows until a library exists.

- [ ] **Step 1: Write the failing cold-start test**

Add a test that stores a `watch:abc` record with `putDeviceRecords`, calls `reapplyDeviceRecords()` while `torrents.value = []`, then sets the ABC library row and expects `watchesNewEpisodes(torrents.value[0].data)` to be `false`.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run tests/store/applyPulled.test.ts -t "reapplies persisted records after a cold start"`
Expected: FAIL because `reapplyDeviceRecords` is not defined.

- [ ] **Step 3: Implement the projection entry point**

In `src/store/applyPulled.ts` export `reapplyDeviceRecords(): void` as the idempotent application of `deviceRecords()` through the existing `applyPulled` path. Do not create another merge path.

In both app entry points call it inside the existing `hydrateDeviceDb` callback before `runDeviceSync()`.

- [ ] **Step 4: Run the projection tests**

Run: `npx vitest run tests/store/applyPulled.test.ts tests/store/migrateRemembered.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/applyPulled.ts src/main.tsx mobile/src/main.tsx tests/store/applyPulled.test.ts
git commit -m "fix: восстановить sync проекцию после запуска"
```

### Task 2: Monotonic same-device progress writes

**Files:**
- Create: `src/player/progressWriteSeq.ts`
- Modify: `src/player/progressSave.ts`
- Modify: `src/viewer/progressSync.ts`
- Modify: `ops/billing/src/playbackProgress.mjs`
- Modify: `ops/billing/src/db/pg/playbackSql.mjs`
- Modify: `ops/billing/src/db/pg/schema.mjs`
- Test: `tests/player/progressWriteSeq.test.ts`
- Test: `ops/billing/test/progressRoute.test.ts`

**Interfaces:**
- Client produces `nextProgressWriteSeq(): number`, a safe integer monotonically increasing in this device installation, including same-millisecond writes.
- `ProgressPush` gains optional `writerSeq?: number`; the request field is `writerSeq` encoded as a decimal string.
- Server parser produces `writerSeq: number`; legacy absence maps to zero.
- PostgreSQL stores `writer_seq bigint NOT NULL DEFAULT 0`. A different device or a legacy zero keeps legacy behavior; otherwise the existing row accepts only a larger sequence.

- [ ] **Step 1: Write failing client sequence tests**

Create tests with mocked `Date.now` proving two calls in the same millisecond differ, and a later call after a simulated module reload does not reuse the persisted sequence. Use the existing `localStorage` test environment.

- [ ] **Step 2: Run the client test and verify RED**

Run: `npx vitest run tests/player/progressWriteSeq.test.ts`
Expected: FAIL because `nextProgressWriteSeq` is not defined.

- [ ] **Step 3: Implement the persistent monotonic sequence**

In `src/player/progressWriteSeq.ts` keep the last value in memory and in `localStorage` through the existing `loadJson`/`saveJson` helpers. Base each value on `max(Date.now() * 1000, previous + 1)` so it remains below `Number.MAX_SAFE_INTEGER` for current dates.

- [ ] **Step 4: Verify the client sequence**

Run: `npx vitest run tests/player/progressWriteSeq.test.ts`
Expected: PASS.

- [ ] **Step 5: Add failing server ordering tests**

Extend `ops/billing/test/progressRoute.test.ts`:

1. Save position 120 with `writerSeq: 2`, then position 90 with `writerSeq: 1` from DEV_A; GET must still return 120.
2. Save from DEV_B with `writerSeq: 1`; the other-device write must be accepted.
3. Keep all existing requests without `writerSeq` unchanged.

- [ ] **Step 6: Run the server test and verify RED**

Run: `npx vitest run --config ops/billing/vitest.config.ts ops/billing/test/progressRoute.test.ts`
Expected: FAIL because the delayed DEV_A write still replaces position 120.

- [ ] **Step 7: Implement protocol and conditional persistence**

Add optional `writerSeq` to `ProgressPush` and assign `nextProgressWriteSeq()` in the existing remote branch of `saveItemProgress`, so all HTML and native callers use it without changing their signatures.

Parse and bound `writerSeq` as a non-negative safe integer. Add migration `021_playback_progress_writer_seq`, include the column in the upsert, and add the conditional same-device guard to `ON CONFLICT DO UPDATE`. Do not return the internal sequence from GET.

- [ ] **Step 8: Run client and server progress tests**

Run: `npx vitest run tests/player/progressWriteSeq.test.ts tests/viewer/progressSync.test.ts`
Run: `npx vitest run --config ops/billing/vitest.config.ts ops/billing/test/progressRoute.test.ts ops/billing/test/deviceSync.test.ts`
Expected: PASS, including unchanged legacy request bodies.

- [ ] **Step 9: Update changelogs and verify the deliverable**

Add one user-visible Russian and English changelog entry describing reliable cross-device resume after delayed responses.

Run: `npm run build`
Run: `npm run build:mobile`
Run: `git diff --check`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add src/player/progressWriteSeq.ts src/player/progressSave.ts src/viewer/progressSync.ts ops/billing/src/playbackProgress.mjs ops/billing/src/db/pg/playbackSql.mjs ops/billing/src/db/pg/schema.mjs tests/player/progressWriteSeq.test.ts ops/billing/test/progressRoute.test.ts CHANGELOG.md CHANGELOG.en.md
git commit -m "fix: не откатывать прогресс поздним ответом"
```

## Completion Gate

- Open one PR for this foundation plan and wait for build, android and billing.
- Do not start server `/v2`, WebSocket or presence in the same PR.
- After merge, write a separate plan for server revisions and the `/v2` change log.

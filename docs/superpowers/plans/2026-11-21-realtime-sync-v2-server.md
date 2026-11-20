# Realtime Sync V2 Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a commit-safe, idempotent HTTP `/v2/sync` server without changing current client behavior.

**Architecture:** Reuse `device_sync` as the current LWW snapshot. Serialize each account through a counter row locked to commit, append every accepted mutation to a per-account change log and retain mutation results separately. Route legacy `/v1` writes through the same mutation service while keeping its existing cursor response.

**Tech Stack:** Node.js, PostgreSQL, Vitest; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-20-realtime-device-sync-design.md`

## Global Constraints

- Current `/v1/sync` clients keep the same request and response shape.
- Revision is per account and assigned by a locked counter row held to commit.
- `mutationId` results survive change-log cleanup; expired retries are rejected without applying data.
- No WebSocket, presence, client `/v2` migration or production deploy in this plan.
- All Greptile findings must be addressed before completion.

## Review Focus

- Concurrent devices must observe every per-account revision without a gap.
- Repeating a mutation after a lost response must return the original ack and add no change.
- Legacy `/v1` writes must appear in `/v2` pulls.
- An expired mutation must not apply a late outbox body.
- Existing migration rows must be available to a new `/v2` client at revision zero.

### Task 1: Schema, mutation service and HTTP `/v2`

**Files:**
- Create: `ops/billing/src/deviceSyncV2.mjs`
- Modify: `ops/billing/src/deviceSync.mjs`
- Modify: `ops/billing/src/db/pg/schema.mjs`
- Modify: `ops/billing/src/server.mjs`
- Modify: `ops/billing/test/stores.test.ts`
- Test: `ops/billing/test/deviceSyncV2.test.ts`

**Interfaces:**
- `parseSyncV2Body(raw): { since: number, records: SyncRecordV2[] } | { error: string }`; every record has a non-empty `mutationId` of at most 100 characters.
- `createSyncV2Store(store).mutate(accountId, deviceId, records, now): Promise<Array<{ recordId: string, mutationId: string, revision: number }>>`.
- `createSyncV2Store(store).pull(accountId, since, limit = 500): Promise<Array<SyncRecordV2 & { revision: number }>>`.
- `POST /v2/sync` accepts `{ since, records }` and returns `{ ok, records, nextRevision, ack, serverTime }`.

- [ ] Write failing PostgreSQL tests for initial mutation, repeat ack and pull pagination.
- [ ] Run them in Linux CI or a configured PostgreSQL 17 environment and verify RED before implementation when available; Windows without PostgreSQL is not a green claim.
- [ ] Add migration `022_device_sync_v2` with counters, changes and mutation results; migrate existing snapshots into per-account revisions.
- [ ] Implement the counter-locked `withClient` mutation service and `/v2` route with current subscription authorization.
- [ ] Add migration 022 to the exact schema version expectation.
- [ ] Run parser checks, `node --check`, billing tests and `npm run build`.
- [ ] Commit `feat: серверные revision и HTTP sync v2`.

### Task 2: Legacy projection and adversarial coverage

**Files:**
- Modify: `ops/billing/src/server.mjs`
- Modify: `ops/billing/src/deviceSyncV2.mjs`
- Test: `ops/billing/test/deviceSyncV2.test.ts`

**Interfaces:**
- Legacy records receive deterministic `v1:<deviceId>:<recordId>:<updatedAt>` mutation ids.
- `/v1/sync` keeps its `nextSeq` response but shares the v2 mutation path.
- V2 expired mutation responses use HTTP 409 `{ error: "mutation_expired" }`; legacy retries return the saved ack without applying the expired body, so a legacy batch can continue with newer records.

- [ ] Write failing tests proving `/v1` rows are visible to `/v2`, two concurrent writers produce a gapless revision stream and expired retries do not change the snapshot.
- [ ] Implement the smallest shared legacy mapping and expiry response.
- [ ] Run the full billing suite, root build and `git diff --check`.
- [ ] Update the implementation notes and changelog as `[tech]`.
- [ ] Commit `feat: связать sync v1 и v2`.
- [ ] Request independent whole-branch review, fix every confirmed finding and open one PR without merging it automatically.

// Push and pull remembered rows. A refused sync (no subscription) leaves the local copy as it is.
import { BILLING_ORIGIN } from './config';
import { runV2, setV2SyncContext, shouldUseV2, stopV2Socket } from './deviceSyncV2Client';
import { createSyncLeader, type SyncLeader } from './syncLeader';
import { publishSyncV2Result, resetSyncV2Status, syncV2Status } from './syncV2Status';
import { billingSession, deviceId, legacySyncLink, onBillingChange } from './session';
import { withDeviceToken } from './tokens';
import { ackSent, markSyncError, markSynced, noteSyncAccount, onDeviceWrite, putDeviceRecords, setSyncCursor, syncCursor, syncEnabled, unsentRecords } from '../store/deviceDb';
import { applyPulled } from '../store/applyPulled';
import type { SyncRecord } from '../store/syncMerge';
import type { SourceContext } from '../sources/types';

const BATCH = 200;
let timer = 0;
let syncing = false;
let again = false;
let contextOf: () => SourceContext | null = () => null;

/** Android passes the same source context the rest of billing uses. A browser keeps window.fetch. */
export function setSyncContext(fn: (() => SourceContext | null) | null): void {
  contextOf = fn || (() => null);
  setV2SyncContext(fn);
}

export function scheduleDeviceSync(): void {
  if (!syncEnabled() || timer) return;
  const session = billingSession();
  if (!session || !(session.access || session.token)) return;
  timer = setTimeout(() => {
    timer = 0;
    runDeviceSync();
  }, 1500) as unknown as number;
}

function parseAnswer(status: number, text: string): { status: number; data: { ok?: boolean; records?: SyncRecord[]; nextSeq?: number; error?: string } } {
  let data: { ok?: boolean; records?: SyncRecord[]; nextSeq?: number; error?: string } = {};
  try {
    const parsed = JSON.parse(text || '{}');
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch (e) {
    data = {};
  }
  return { status: status, data: data };
}

function post(owner: string, since: number, records: SyncRecord[]): Promise<{ status: number; data: { ok?: boolean; records?: SyncRecord[]; nextSeq?: number; error?: string; switched?: boolean } }> {
  const body = JSON.stringify({ since: since, records: records });
  const ctx = contextOf();
  if (ctx && ctx.http.postJson) {
    const send = ctx.http.postJson;
    return withDeviceToken(ctx, (headers) => {
      if (accountNow() !== owner) return Promise.resolve({ status: 409, url: '', text: '{"switched":true}' });
      return send(BILLING_ORIGIN + '/v1/sync', JSON.stringify({ since: since, records: records }), { headers: headers, timeoutMs: 20000 });
    }).then(
      (res) => parseAnswer(res.status, res.text),
      () => ({ status: 0, data: {} }),
    );
  }
  const session = billingSession();
  const access = session && (session.access || session.token);
  if (!access || accountNow() !== owner) return Promise.resolve({ status: 409, data: { switched: true } });
  return fetch(BILLING_ORIGIN + '/v1/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + access,
      'x-device-id': deviceId(),
    },
    body: body,
  }).then(
    (res) => res.json().then((data) => ({ status: res.status, data: data || {} })),
    () => ({ status: 0, data: {} }),
  );
}

function accountNow(): string {
  const session = billingSession();
  const access = session && (session.access || session.token);
  if (!access) return '';
  const link = legacySyncLink();
  if (link && session && session.id === link.to) return link.from;
  return session && session.id ? session.id : access.slice(0, 16);
}

function sameAccount(owner: string): boolean {
  return accountNow() === owner;
}

function pump(owner: string, since: number, pending: SyncRecord[]): Promise<string> {
  const chunk = pending.slice(0, BATCH);
  const rest = pending.slice(BATCH);
  return post(owner, since, chunk).then((ans) => {
    if (!sameAccount(owner) || ans.data.switched) return 'switched';
    if (ans.status === 0) {
      markSyncError('offline');
      return 'error';
    }
    if (ans.status === 403) {
      markSyncError('denied');
      return 'subscribers';
    }
    if (ans.status !== 200 || !ans.data.ok) {
      markSyncError('error');
      return 'error';
    }
    const incoming = ans.data.records || [];
    if (incoming.length) {
      const merged = putDeviceRecords(incoming, true);
      const won: SyncRecord[] = [];
      for (let i = 0; i < incoming.length; i++) {
        const row = incoming[i];
        const kept = merged.filter((m) => m.id === row.id)[0];
        if (kept && kept.updatedAt === row.updatedAt && kept.deviceId === row.deviceId && !!kept.deleted === !!row.deleted) won.push(kept);
      }
      if (won.length) applyPulled(won);
    }
    if (chunk.length) ackSent(chunk);
    const next = typeof ans.data.nextSeq === 'number' ? ans.data.nextSeq : since;
    setSyncCursor(next);
    markSynced(Date.now());
    if (rest.length) return pump(owner, next, rest);
    if (incoming.length >= 500) return pump(owner, next, []);
    return 'ok';
  });
}

function finish(status: string): Promise<string> {
  syncing = false;
  if (!again) return Promise.resolve(status);
  again = false;
  return runDeviceSync();
}

let v2Leader: SyncLeader | null = null;
let v2LeaderOwner = '';
let v2RunOwned: (() => Promise<string>) | null = null;

function stopV2Runtime(): void {
  if (v2Leader) v2Leader.stop();
  v2Leader = null;
  v2LeaderOwner = '';
  v2RunOwned = null;
  stopV2Socket();
}

function runV2Leader(owner: string, epoch: number): Promise<string> {
  if (!v2Leader || v2LeaderOwner !== owner) {
    stopV2Runtime();
    resetSyncV2Status();
    let running: Promise<string> | null = null;
    v2RunOwned = () => {
      if (running) return running;
      running = runV2(owner, epoch, () => sameAccount(owner) && !!v2Leader && v2Leader.isLeader()).finally(() => { running = null; });
      return running;
    };
    v2LeaderOwner = owner;
    v2Leader = createSyncLeader({
      deviceId: deviceId(),
      run: () => v2RunOwned ? v2RunOwned() : 'error',
      publish: (value) => {
        const status = typeof value === 'string' ? value : 'error';
        publishSyncV2Result(owner, status, syncV2Status().transport);
      },
    });
    v2Leader.start();
  }
  const leader = v2Leader;
  const run = v2RunOwned!;
  if (leader.isLeader()) {
    return Promise.resolve().then(() => leader.isLeader() ? run() : 'busy');
  }
  leader.request();
  return Promise.resolve('busy');
}

function pumpSelected(owner: string, epoch: number, pending: SyncRecord[]): Promise<string> {
  const v1 = () => {
    if (!sameAccount(owner)) return Promise.resolve('switched');
    stopV2Runtime();
    return pump(owner, syncCursor(), pending).then((status) => {
      publishSyncV2Result(owner, status, 'v1');
      return status;
    });
  };
  return shouldUseV2(owner, () => sameAccount(owner)).then((useV2) => {
    if (!sameAccount(owner)) return 'switched';
    if (!useV2) return v1();
    try {
      return runV2Leader(owner, epoch).then((status) => {
        if (!sameAccount(owner)) return 'switched';
        if (status === 'v1') return v1();
        if (status === 'offline') return 'error';
        if (status === 'denied') return 'subscribers';
        return status;
      });
    } catch (e) {
      return v1();
    }
  }, v1);
}

export function runDeviceSync(): Promise<string> {
  if (!syncEnabled()) {
    stopV2Runtime();
    return Promise.resolve('off');
  }
  const session = billingSession();
  const access = session && (session.access || session.token);
  if (!access) {
    stopV2Runtime();
    return Promise.resolve('local');
  }
  if (syncing) {
    again = true;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    return Promise.resolve('busy');
  }
  syncing = true;
  const owner = accountNow();
  seenAccount = owner;
  const epoch = noteSyncAccount(owner);
  const pending = unsentRecords(epoch);
  return pumpSelected(owner, epoch, pending).then(
    (status) => finish(status),
    () => finish('error'),
  );
}

let seenAccount = accountNow();
let seenAccess = '';
onBillingChange(() => {
  const session = billingSession();
  const access = session && (session.access || session.token) ? session.access || session.token : '';
  const id = accountNow();
  const changed = id !== seenAccount || access !== seenAccess;
  seenAccount = id;
  seenAccess = access;
  if (changed && id) scheduleDeviceSync();
});

onDeviceWrite(scheduleDeviceSync);
if (typeof window !== 'undefined') window.addEventListener('pagehide', stopV2Socket);

export interface SyncDeviceRow {
  id: string;
  name: string;
  lastAt: number;
  self: boolean;
}

/** Devices that have synced this account. Empty when the call cannot be made. */
export function fetchSyncDevices(): Promise<SyncDeviceRow[]> {
  const read = (status: number, text: string): SyncDeviceRow[] => {
    if (status !== 200) return [];
    let data: { devices?: SyncDeviceRow[] } = {};
    try {
      const parsed = JSON.parse(text || '{}');
      if (parsed && typeof parsed === 'object') data = parsed;
    } catch (e) {
      return [];
    }
    return Array.isArray(data.devices) ? data.devices : [];
  };
  const ctx = contextOf();
  if (ctx) {
    return withDeviceToken(ctx, (headers) => ctx.http.get(BILLING_ORIGIN + '/v1/sync/devices', { headers: headers, timeoutMs: 12000 })).then(
      (res) => read(res.status, res.text),
      () => [],
    );
  }
  const session = billingSession();
  const access = session && (session.access || session.token);
  if (!access) return Promise.resolve([]);
  return fetch(BILLING_ORIGIN + '/v1/sync/devices', {
    headers: { authorization: 'Bearer ' + access, 'x-device-id': deviceId() },
  }).then(
    (res) => res.text().then((text) => read(res.status, text)),
    () => [],
  );
}

// Push and pull remembered rows. A refused sync (no subscription) leaves the local copy as it is.
import { BILLING_ORIGIN } from './config';
import { billingSession, deviceId, onBillingChange } from './session';
import { ackSent, markSynced, noteSyncAccount, onDeviceWrite, putDeviceRecords, setSyncCursor, syncCursor, syncEnabled, unsentRecords } from '../store/deviceDb';
import { applyPulled } from '../store/applyPulled';
import type { SyncRecord } from '../store/syncMerge';

const BATCH = 200;
let timer = 0;
let syncing = false;
let again = false;

export function scheduleDeviceSync(): void {
  if (!syncEnabled() || timer) return;
  const session = billingSession();
  if (!session || !(session.access || session.token)) return;
  timer = setTimeout(() => {
    timer = 0;
    runDeviceSync();
  }, 1500) as unknown as number;
}

function post(access: string, since: number, records: SyncRecord[]): Promise<{ status: number; data: { ok?: boolean; records?: SyncRecord[]; nextSeq?: number; error?: string } }> {
  return fetch(BILLING_ORIGIN + '/v1/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + access,
      'x-device-id': deviceId(),
    },
    body: JSON.stringify({ since: since, records: records }),
  }).then(
    (res) => res.json().then((data) => ({ status: res.status, data: data || {} })),
    () => ({ status: 0, data: {} }),
  );
}

function accountNow(): string {
  const session = billingSession();
  const access = session && (session.access || session.token);
  if (!access) return '';
  return session && session.id ? session.id : access.slice(0, 16);
}

function pump(access: string, owner: string, since: number, pending: SyncRecord[]): Promise<string> {
  const chunk = pending.slice(0, BATCH);
  const rest = pending.slice(BATCH);
  return post(access, since, chunk).then((ans) => {
    if (accountNow() !== owner) return 'switched';
    if (ans.status === 403) return 'subscribers';
    if (ans.status !== 200 || !ans.data.ok) return 'error';
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
    if (rest.length) return pump(access, owner, next, rest);
    if (incoming.length >= 500) return pump(access, owner, next, []);
    return 'ok';
  });
}

function finish(status: string): Promise<string> {
  syncing = false;
  if (!again) return Promise.resolve(status);
  again = false;
  return runDeviceSync();
}

export function runDeviceSync(): Promise<string> {
  if (!syncEnabled()) return Promise.resolve('off');
  const session = billingSession();
  const access = session && (session.access || session.token);
  if (!access) return Promise.resolve('local');
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
  return pump(access, owner, syncCursor(), pending).then(
    (status) => finish(status),
    () => finish('error'),
  );
}

let seenAccount = accountNow();
onBillingChange(() => {
  const id = accountNow();
  if (id === seenAccount) return;
  seenAccount = id;
  if (id) scheduleDeviceSync();
});

onDeviceWrite(scheduleDeviceSync);

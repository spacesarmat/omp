// Push and pull remembered rows. A refused sync (no subscription) leaves the local copy as it is.
import { BILLING_ORIGIN } from './config';
import { billingSession, deviceId } from './session';
import { ackSent, markSynced, noteSyncAccount, onDeviceWrite, putDeviceRecords, setSyncCursor, syncCursor, syncEnabled, unsentRecords } from '../store/deviceDb';
import { applyPulled } from '../store/applyPulled';
import type { SyncRecord } from '../store/syncMerge';

const BATCH = 200;
let timer = 0;
let syncing = false;

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

function pump(access: string, since: number, pending: SyncRecord[]): Promise<string> {
  const chunk = pending.slice(0, BATCH);
  const rest = pending.slice(BATCH);
  return post(access, since, chunk).then((ans) => {
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
    if (rest.length) return pump(access, next, rest);
    if (incoming.length >= 500) return pump(access, next, []);
    return 'ok';
  });
}

export function runDeviceSync(): Promise<string> {
  if (!syncEnabled()) return Promise.resolve('off');
  const session = billingSession();
  const access = session && (session.access || session.token);
  if (!access) return Promise.resolve('local');
  if (syncing) return Promise.resolve('busy');
  syncing = true;
  const epoch = noteSyncAccount(session && session.id ? session.id : access.slice(0, 16));
  const pending = unsentRecords(epoch);
  return pump(access, syncCursor(), pending).then(
    (status) => {
      syncing = false;
      return status;
    },
    () => {
      syncing = false;
      return 'error';
    },
  );
}

onDeviceWrite(scheduleDeviceSync);

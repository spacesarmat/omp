// Push and pull remembered rows. A refused sync (no subscription) leaves the local copy as it is.
import { BILLING_ORIGIN } from './config';
import { billingSession, deviceId } from './session';
import { deviceRecords, lastSyncAt, markSynced, putDeviceRecords, syncEnabled } from '../store/deviceDb';
import { sinceRecords } from '../store/syncMerge';

export function runDeviceSync(): Promise<string> {
  if (!syncEnabled()) return Promise.resolve('off');
  const session = billingSession();
  const access = session && (session.access || session.token);
  if (!access) return Promise.resolve('local');
  const since = lastSyncAt();
  const records = sinceRecords(deviceRecords(), since);
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
  ).then((ans) => {
    if (ans.status === 403) return 'subscribers';
    const data = ans.data as { ok?: boolean; records?: unknown; serverTime?: number };
    if (ans.status !== 200 || !data.ok) return 'error';
    const incoming = data.records && Array.isArray(data.records) ? data.records : [];
    if (incoming.length) putDeviceRecords(incoming);
    let cursor = since;
    for (let i = 0; i < records.length; i++) if (records[i].updatedAt > cursor) cursor = records[i].updatedAt;
    for (let i = 0; i < incoming.length; i++) {
      const at = incoming[i] && typeof incoming[i].updatedAt === 'number' ? incoming[i].updatedAt : 0;
      if (at > cursor) cursor = at;
    }
    markSynced(cursor);
    return 'ok';
  });
}

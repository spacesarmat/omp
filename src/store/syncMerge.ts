// Last-write-wins merge for remembered data. A newer updatedAt wins. The same time
// keeps the greater device id, so two devices do not flip a row. A delete is a tombstone
// with its own time, not a missing row. Chromium 53: no ?., no ??.

export interface SyncRecord {
  id: string;
  kind: string;
  key: string;
  body: { [k: string]: unknown };
  updatedAt: number;
  deviceId: string;
  deleted?: boolean;
}

export function newer(a: SyncRecord, b: SyncRecord): SyncRecord {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return String(a.deviceId || '') >= String(b.deviceId || '') ? a : b;
}

/** Merge two sets. The result has one row per id. */
export function mergeRecords(local: SyncRecord[], remote: SyncRecord[]): SyncRecord[] {
  const byId: { [id: string]: SyncRecord } = {};
  const put = (row: SyncRecord) => {
    if (!row || !row.id) return;
    const prev = byId[row.id];
    byId[row.id] = prev ? newer(prev, row) : row;
  };
  for (let i = 0; i < local.length; i++) put(local[i]);
  for (let i = 0; i < remote.length; i++) put(remote[i]);
  const ids = Object.keys(byId);
  const out: SyncRecord[] = [];
  for (let i = 0; i < ids.length; i++) out.push(byId[ids[i]]);
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Rows the other side does not have yet, or has older. */
export function sinceRecords(rows: SyncRecord[], since: number): SyncRecord[] {
  const out: SyncRecord[] = [];
  for (let i = 0; i < rows.length; i++) if (rows[i].updatedAt > since) out.push(rows[i]);
  return out;
}

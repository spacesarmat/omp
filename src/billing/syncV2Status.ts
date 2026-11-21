import { readV2Meta, readV2Outbox } from '../store/deviceV2Db';

export interface SyncV2Status {
  transport: '' | 'v1' | 'http' | 'websocket';
  pending: number;
  blocked: number;
  revision: number;
  lastAt: number;
  lastError: string;
}

const empty = (): SyncV2Status => ({ transport: '', pending: 0, blocked: 0, revision: 0, lastAt: 0, lastError: '' });
let current = empty();
let refreshSequence = 0;
const listeners = new Set<() => void>();

export function syncV2Status(): SyncV2Status {
  return current;
}

export function updateSyncV2Status(patch: Partial<SyncV2Status>): void {
  current = { ...current, ...patch };
  for (const listener of listeners) listener();
}

export function resetSyncV2Status(): void {
  refreshSequence++;
  current = empty();
  for (const listener of listeners) listener();
}

export function onSyncV2Status(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshSyncV2Status(owner: string): Promise<void> {
  const sequence = ++refreshSequence;
  const [outbox, meta] = await Promise.all([readV2Outbox(owner), readV2Meta(owner)]);
  if (sequence !== refreshSequence) return;
  updateSyncV2Status({
    pending: outbox.filter((row) => !row.blocked).length,
    blocked: outbox.filter((row) => row.blocked).length,
    revision: meta.revision,
  });
}

export function publishSyncV2Result(owner: string, status: string, transport: SyncV2Status['transport']): void {
  updateSyncV2Status({
    transport,
    lastAt: status === 'ok' ? Date.now() : current.lastAt,
    lastError: status === 'ok' ? '' : status,
  });
  void refreshSyncV2Status(owner).catch(() => undefined);
}

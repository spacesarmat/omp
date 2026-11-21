import type { BillingAccount } from './session';
import { loadJson, saveJson } from '../store/storage';
import { checkV2Capability } from '../store/deviceV2Db';

const KEY = 'omp.syncV2';
export type SyncV2Mode = 'auto' | 'on' | 'off';
let cache = new Map<string, boolean>();

export function syncV2Mode(): SyncV2Mode {
  const mode = loadJson<unknown>(KEY, 'auto', (value) => value === 'auto' || value === 'on' || value === 'off');
  return mode as SyncV2Mode;
}

export function setSyncV2Mode(mode: SyncV2Mode): void {
  saveJson(KEY, mode);
  cache = new Map();
}

export function resetSyncV2Capabilities(): void {
  cache = new Map();
}

export async function canUseV2(account: BillingAccount | null): Promise<boolean> {
  if (!account || !account.sync || account.sync.v2 === false) return false;
  const mode = syncV2Mode();
  if (mode === 'off') return false;
  const key = account.telegramId + ':' + mode;
  if (mode === 'auto' && cache.has(key)) return cache.get(key)!;
  if (typeof indexedDB === 'undefined' || typeof WebSocket === 'undefined') {
    cache.set(key, false);
    return false;
  }
  const capable = await checkV2Capability().catch(() => false);
  cache.set(key, capable);
  return capable;
}

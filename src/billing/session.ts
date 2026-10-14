import { loadJson, saveJson } from '../store/storage';

const DEVICE_KEY = 'tsp.billingDevice';
const SESSION_KEY = 'tsp.billingSession';
const PENDING_CODE_KEY = 'tsp.billingPendingCode';

export interface BillingSession {
  token: string;
  paidUntil: number;
}

export interface BillingAccount {
  telegramId: string;
  paidUntil: number;
  active: boolean;
  deviceLimit: number;
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
  return out;
}

/** Stable id of this install. A reinstall is a new device, so the old code stops working. */
export function deviceId(): string {
  const cur = loadJson<string>(DEVICE_KEY, '', (v) => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v));
  if (cur) return cur;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = hex(bytes);
  saveJson(DEVICE_KEY, id);
  return id;
}

export function billingSession(): BillingSession | null {
  return loadJson<BillingSession | null>(SESSION_KEY, null, (v) => {
    if (!v || typeof v !== 'object') return false;
    const row = v as BillingSession;
    return typeof row.token === 'string' && row.token.length > 0 && typeof row.paidUntil === 'number';
  });
}

export function saveBillingSession(row: BillingSession | null): void {
  if (!row) {
    saveJson(SESSION_KEY, null);
    return;
  }
  saveJson(SESSION_KEY, row);
}

type Listener = () => void;
const listeners: Listener[] = [];

export function onBillingChange(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function emitBillingChange(): void {
  for (let i = 0; i < listeners.length; i++) listeners[i]();
}

/** Code arrived via omp:// deep link before the Sources screen opened. */
export function pendingBillingCode(): string {
  return loadJson<string>(PENDING_CODE_KEY, '', (v) => typeof v === 'string' && v.length > 0);
}

export function setPendingBillingCode(code: string | null): void {
  saveJson(PENDING_CODE_KEY, code || '');
  emitBillingChange();
}

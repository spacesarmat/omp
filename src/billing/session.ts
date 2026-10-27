import { loadJson, saveJson } from '../store/storage';

const DEVICE_KEY = 'tsp.billingDevice';
const SESSION_KEY = 'tsp.billingSession';
const PENDING_CODE_KEY = 'tsp.billingPendingCode';
const NOTICE_KEY = 'tsp.billingNotice';
const ACCOUNT_KEY = 'tsp.billingAccountSeen';

/**
 * This phone's binding to a subscription code. Since PR-5 it holds the short-lived access token; the
 * refresh token lives in the Android Keystore (`refresh` here only where there is no Keystore). Apps before
 * PR-5 saved an opaque `token`; it is swapped for the pair once (/v1/token/upgrade).
 */
export interface BillingSession {
  /** Opaque long-lived token of an app before PR-5; '' once the phone has the token pair. */
  token: string;
  paidUntil: number;
  /** Stable id of this binding (the cached /v1/me answer is tied to it; the tokens rotate). */
  id?: string;
  /** Access token `a1.…` (24 h) and its expiry, unix ms. */
  access?: string;
  accessExp?: number;
  /** Expiry of the refresh token, unix ms. */
  refreshExp?: number;
  /** Browser build only (no Keystore): the refresh token. On Android it is never stored here. */
  refresh?: string;
  /** Android: the Keystore refused the refresh token, it lives in memory only (a restart needs the code again). */
  volatile?: boolean;
}

/**
 * Why the session was dropped, shown above the code field until a new code works: `revoked` by the server,
 * `keystore` when the refresh token could not be kept in the Keystore and the app restarted.
 */
export type BillingNotice = '' | 'revoked' | 'keystore';

export interface BillingAccount {
  telegramId: string;
  paidUntil: number;
  active: boolean;
  deviceLimit: number;
  /** After paidUntil, inside the grace period: search still works until accessUntil. */
  inGrace?: boolean;
  accessUntil?: number;
  /** This phone is bound but over the device limit (an extra slot was not renewed). */
  overLimit?: boolean;
  /** Which paid indexers the server currently exposes for this subscription. */
  sources?: { jackett: boolean; jacred: boolean };
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
    if (typeof row.token !== 'string' || typeof row.paidUntil !== 'number') return false;
    return row.token.length > 0 || (typeof row.access === 'string' && row.access.length > 0);
  });
}

/** Key of the binding for cached answers: the stable id, or the legacy token of an app before PR-5. */
export function sessionKey(row: BillingSession): string {
  return row.id || row.token;
}

/** True while the session still runs on the opaque token of an app before PR-5. */
export function isLegacySession(row: BillingSession): boolean {
  return !row.access && row.token.length > 0;
}

export function billingNotice(): BillingNotice {
  return loadJson<BillingNotice>(NOTICE_KEY, '', (v) => v === '' || v === 'revoked' || v === 'keystore');
}

export function setBillingNotice(notice: BillingNotice): void {
  saveJson(NOTICE_KEY, notice);
}

export function saveBillingSession(row: BillingSession | null): void {
  if (!row) {
    saveJson(SESSION_KEY, null);
    return;
  }
  saveJson(SESSION_KEY, row);
}

/**
 * The last /v1/me answer in short: this install is linked to an OMP account (a code or Telegram) and its paid-until
 * date. Only for the Settings row, so it does not flash «Войти» while the account is checked again.
 */
export interface SeenAccount {
  paidUntil: number;
}

export function seenAccount(): SeenAccount | null {
  return loadJson<SeenAccount | null>(ACCOUNT_KEY, null, (v) => !!v && typeof v === 'object' && typeof (v as SeenAccount).paidUntil === 'number');
}

export function saveSeenAccount(row: SeenAccount | null): void {
  saveJson(ACCOUNT_KEY, row ? { paidUntil: Number(row.paidUntil) || 0 } : null);
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

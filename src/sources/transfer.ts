// «Передать на телевизор»: the phone sends its source switches (and, if asked, the rutracker login) to OMP on
// Android TV over the pairing channel (POST /omp/sources with the bearer token, android/.../control/ControlRouter.kt).
// The TV's native side checks the request, writes the login to the Keystore storage and hands the page
// `remoteSources { id, sources, rutracker, phone }` (never the password); the page applies the switches, signs in
// with the saved login and answers remoteSourcesDone { id, rutracker }.
// Shared by the phone and the TV bundles: Chromium 53 rules.
import { isObject, loadJson, saveJson } from '../store/storage';
import { rutrackerLoginSaved, RUTRACKER_BAD_LOGIN, RUTRACKER_CAPTCHA } from './rutracker';
import { clearHealth, isSourceOn, setHealth, setSourceOn } from './store';
import type { Source, SourceContext } from './types';

export const TRANSFER_PATH = '/omp/sources';
export const TRANSFER_VERSION = 1;
// the same limits as ControlRouter (Kotlin)
export const MAX_TRANSFER_SOURCES = 40;
export const MAX_USERNAME = 100;
export const MAX_PASSWORD = 200;
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_ALL = /[\u0000-\u001f\u007f]/g;

export interface TransferLogin {
  username: string;
  password: string;
}

/** Body of POST /omp/sources. */
export interface TransferPayload {
  v: number;
  sources: { [id: string]: boolean };
  rutracker?: TransferLogin;
}

/** What the TV answers about the rutracker login. */
export type RutrackerResult = 'ok' | 'bad_login' | 'captcha' | 'error';

const RESULTS: RutrackerResult[] = ['ok', 'bad_login', 'captcha', 'error'];

export function isRutrackerResult(v: unknown): v is RutrackerResult {
  return typeof v === 'string' && RESULTS.indexOf(v as RutrackerResult) >= 0;
}

function validLogin(v: unknown): TransferLogin | null {
  if (!isObject(v)) return null;
  const u = v.username;
  const p = v.password;
  if (typeof u !== 'string' || typeof p !== 'string') return null;
  const user = u.trim();
  if (!user || user.length > MAX_USERNAME || CONTROL.test(user)) return null;
  if (!p || p.length > MAX_PASSWORD) return null;
  return { username: user, password: p };
}

function validSources(v: unknown): { [id: string]: boolean } | null {
  if (!isObject(v)) return null;
  const ids = Object.keys(v);
  if (ids.length < 1 || ids.length > MAX_TRANSFER_SOURCES) return null;
  const out: { [id: string]: boolean } = {};
  for (let i = 0; i < ids.length; i++) {
    const on = v[ids[i]];
    if (!SOURCE_ID.test(ids[i]) || typeof on !== 'boolean') return null;
    out[ids[i]] = on;
  }
  return out;
}

/** The payload as the TV accepts it (same schema as ControlRouter), else null. Unknown keys are refused. */
export function validateTransferPayload(v: unknown): TransferPayload | null {
  if (!isObject(v) || v.v !== TRANSFER_VERSION) return null;
  const keys = Object.keys(v);
  for (let i = 0; i < keys.length; i++) if (keys[i] !== 'v' && keys[i] !== 'sources' && keys[i] !== 'rutracker') return null;
  const sources = validSources(v.sources);
  if (!sources) return null;
  const out: TransferPayload = { v: TRANSFER_VERSION, sources };
  if (v.rutracker !== undefined && v.rutracker !== null) {
    const login = validLogin(v.rutracker);
    if (!login) return null;
    out.rutracker = login;
  }
  return out;
}

/** The phone's switches of every source (on and off: the TV mirrors them) and the login when given. */
export function buildTransferPayload(list: Source[], login: TransferLogin | null): TransferPayload {
  const sources: { [id: string]: boolean } = {};
  list.forEach((s) => {
    if (SOURCE_ID.test(s.id)) sources[s.id] = isSourceOn(s);
  });
  const out: TransferPayload = { v: TRANSFER_VERSION, sources };
  if (login) out.rutracker = { username: login.username.trim(), password: login.password };
  return out;
}

// ---- TV side ----

/** The page event of a transfer (no password in it). */
export interface RemoteSources {
  id: string;
  sources: { [id: string]: boolean };
  /** The login was sent and is already in the encrypted storage. */
  rutracker: boolean;
  phone: string;
}

export function parseRemoteSources(d: unknown): RemoteSources | null {
  if (!isObject(d) || typeof d.id !== 'string' || !d.id || d.id.length > 64) return null;
  const sources = validSources(d.sources);
  if (!sources) return null;
  const phone = typeof d.phone === 'string' ? d.phone.replace(CONTROL_ALL, '').trim().slice(0, 64) : '';
  return { id: d.id, sources, rutracker: d.rutracker === true, phone: phone || 'Телефон' };
}

const LAST_KEY = 'tsp.sourcesTransfer';

let listeners: (() => void)[] = [];

/** Called after every applied transfer (the TV screen re-reads the switches); returns the unsubscribe. */
export function onTransferApplied(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((x) => x !== cb);
  };
}

function notify(): void {
  listeners.slice().forEach((cb) => cb());
}

/** The last transfer the TV received: when, from which phone, whether the rutracker login came with it and worked. */
export interface LastTransfer {
  at: number;
  phone: string;
  rutracker: boolean;
}

export function lastTransfer(): LastTransfer | null {
  const v = loadJson<unknown>(LAST_KEY, null, (x) => x === null || isObject(x));
  if (!isObject(v) || typeof v.at !== 'number' || typeof v.phone !== 'string') return null;
  return { at: v.at, phone: v.phone, rutracker: v.rutracker === true };
}

/** After a logout on the TV the rutracker login is no longer «передан с телефона». */
export function forgetTransferredLogin(): void {
  const t = lastTransfer();
  if (t && t.rutracker) saveJson(LAST_KEY, { at: t.at, phone: t.phone, rutracker: false });
}

function loginResult(e: unknown): RutrackerResult {
  const msg = e instanceof Error ? e.message : '';
  if (msg === RUTRACKER_BAD_LOGIN) return 'bad_login';
  if (msg === RUTRACKER_CAPTCHA) return 'captcha';
  return 'error';
}

/**
 * Applies a transfer on the TV: the switches of the sources this TV knows (others are skipped), then the sign-in
 * with the login the native side has just saved. Resolves the rutracker result (undefined without a login).
 */
export function applyRemoteSources(r: RemoteSources, known: Source[], ctx: () => SourceContext, now: () => number = Date.now): Promise<RutrackerResult | undefined> {
  const ids: { [id: string]: boolean } = {};
  known.forEach((s) => {
    ids[s.id] = true;
  });
  Object.keys(r.sources).forEach((id) => {
    if (ids[id]) setSourceOn(id, r.sources[id]);
  });
  notify();
  const save = (rutracker: boolean) => {
    const prev = lastTransfer();
    // a transfer without the login keeps the note about the earlier one
    saveJson(LAST_KEY, { at: now(), phone: r.phone, rutracker: rutracker || (!r.rutracker && !!prev && prev.rutracker) });
    notify();
  };
  if (!r.rutracker || !ids.rutracker) {
    save(false);
    return Promise.resolve(r.rutracker ? 'error' : undefined);
  }
  let p: Promise<void>;
  try {
    p = rutrackerLoginSaved(ctx());
  } catch (e) {
    p = Promise.reject(e);
  }
  return p.then(
    () => {
      clearHealth('rutracker');
      save(true);
      return 'ok' as RutrackerResult;
    },
    (e: unknown) => {
      const res = loginResult(e);
      if (res !== 'error') setHealth('rutracker', { state: 'login', at: now() });
      save(false);
      return res;
    },
  );
}

function two(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** «сегодня» / «вчера» / «03.10.2026» and «18:40» of a transfer, in local time. */
export function transferWhen(at: number, now: number = Date.now()): { day: string; time: string } {
  const d = new Date(at);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();
  const day =
    at >= start && at < start + 86400000
      ? 'сегодня'
      : at >= start - 86400000 && at < start
        ? 'вчера'
        : two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear();
  return { day, time: two(d.getHours()) + ':' + two(d.getMinutes()) };
}

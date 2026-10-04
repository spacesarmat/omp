// «Передать на телевизор»: the phone sends its source switches (and, if asked, the rutracker login) to OMP on
// Android TV over the pairing channel (POST /omp/sources with the bearer token, android/.../control/ControlRouter.kt).
// The TV's native side checks the request, writes the login to the Keystore storage and hands the page
// `remoteSources { id, sources, rutracker, phone, indexers }` (never the password or an API key); the page applies the
// switches, signs in with the saved login and answers remoteSourcesDone { id, rutracker, indexers }.
// Jackett / Prowlarr connections travel with their API keys when the user leaves «вместе с ключами» on: the native side
// stages each key in the encrypted storage (`indexer.pending.<i>.apikey`) and the event says only `key: true`; the page
// moves it to the connection's own entry. The answer never echoes a key.
// Shared by the phone and the TV bundles: Chromium 53 rules.
import { isObject, loadJson, saveJson } from '../store/storage';
import { RUTRACKER_BAD_LOGIN, RUTRACKER_CAPTCHA } from './rutrackerText';
import { indexerId, indexerKeyName, indexerPendingKeyName, INDEXERS_MAX, INDEXER_SOURCE_PREFIX, NAME_MAX, normalizeIndexerUrl, storeIndexer } from './indexerStore';
import type { IndexerConn, IndexerKind } from './indexerStore';
import { clearHealth, getHealth, isSourceOn, setHealth, setSourceOn } from './store';
import type { SecretStore, Source, SourceContext, SourceHealth } from './types';

export const TRANSFER_PATH = '/omp/sources';
export const TRANSFER_VERSION = 1;
// the same limits as ControlRouter (Kotlin)
export const MAX_TRANSFER_SOURCES = 40;
export const MAX_USERNAME = 100;
export const MAX_PASSWORD = 200;
export const MAX_TRANSFER_INDEXERS = INDEXERS_MAX;
export const MAX_INDEXER_URL = 200;
export const MAX_INDEXER_KEY = 200;
/** Body size the TV reads at most (ControlRouter MAX_BODY). */
export const MAX_TRANSFER_BYTES = 16384;
/** Printable ASCII without spaces: what Jackett and Prowlarr keys are made of. */
const INDEXER_KEY = /^[\x21-\x7e]{1,200}$/;
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
// C0, DEL and C1: the same set as Kotlin Char.isISOControl() in SourcesProtocol
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_ALL = /[\u0000-\u001f\u007f-\u009f]/g;
/** How long the phone waits for the TV's answer; an older transfer event on the TV is dropped. */
export const TRANSFER_TIMEOUT_MS = 45000;

export interface TransferLogin {
  username: string;
  password: string;
}

/** A Jackett / Prowlarr connection on its way to the TV; `key` only when sent «вместе с ключами». */
export interface TransferIndexer {
  kind: IndexerKind;
  url: string;
  name?: string;
  key?: string;
}

/** Body of POST /omp/sources. */
export interface TransferPayload {
  v: number;
  sources: { [id: string]: boolean };
  rutracker?: TransferLogin;
  indexers?: TransferIndexer[];
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

function validName(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') return null;
  const n = v.trim();
  return n && n.length <= NAME_MAX && !CONTROL.test(n) ? n : null;
}

const INDEXER_FIELDS = ['kind', 'url', 'name', 'key'];

function validIndexer(v: unknown): TransferIndexer | null {
  if (!isObject(v)) return null;
  const keys = Object.keys(v);
  for (let i = 0; i < keys.length; i++) if (INDEXER_FIELDS.indexOf(keys[i]) < 0) return null;
  if (v.kind !== 'jackett' && v.kind !== 'prowlarr') return null;
  // already in its normal form: the TV derives the connection id (and the key's entry) from it
  if (typeof v.url !== 'string' || v.url.length > MAX_INDEXER_URL || normalizeIndexerUrl(v.url) !== v.url) return null;
  const out: TransferIndexer = { kind: v.kind, url: v.url };
  const name = validName(v.name);
  if (name === null) return null;
  if (name) out.name = name;
  if (v.key !== undefined) {
    if (typeof v.key !== 'string' || !INDEXER_KEY.test(v.key)) return null;
    out.key = v.key;
  }
  return out;
}

function validIndexers(v: unknown): TransferIndexer[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_TRANSFER_INDEXERS) return null;
  const out: TransferIndexer[] = [];
  for (let i = 0; i < v.length; i++) {
    const x = validIndexer(v[i]);
    if (!x || out.some((o) => o.kind === x.kind && o.url === x.url)) return null;
    out.push(x);
  }
  return out;
}

/** UTF-8 length of the JSON body. */
export function transferBytes(p: unknown): number {
  const s = JSON.stringify(p) || '';
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // a surrogate pair is 4 bytes: 2 for each half
    n += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 2 : 3;
  }
  return n;
}

/** The payload as the TV accepts it (same schema as ControlRouter), else null. Unknown keys are refused. */
export function validateTransferPayload(v: unknown): TransferPayload | null {
  if (!isObject(v) || v.v !== TRANSFER_VERSION) return null;
  if (transferBytes(v) > MAX_TRANSFER_BYTES) return null;
  const keys = Object.keys(v);
  for (let i = 0; i < keys.length; i++) if (['v', 'sources', 'rutracker', 'indexers'].indexOf(keys[i]) < 0) return null;
  const sources = validSources(v.sources);
  if (!sources) return null;
  const out: TransferPayload = { v: TRANSFER_VERSION, sources };
  if (v.rutracker !== undefined && v.rutracker !== null) {
    const login = validLogin(v.rutracker);
    if (!login) return null;
    out.rutracker = login;
  }
  if (v.indexers !== undefined) {
    const list = validIndexers(v.indexers);
    if (!list) return null;
    out.indexers = list;
  }
  return out;
}

/** The phone's switches of every source (on and off: the TV mirrors them), the login and the connections when given. */
export function buildTransferPayload(list: Source[], login: TransferLogin | null, indexers?: TransferIndexer[]): TransferPayload {
  const sources: { [id: string]: boolean } = {};
  list.forEach((s) => {
    if (SOURCE_ID.test(s.id)) sources[s.id] = isSourceOn(s);
  });
  const out: TransferPayload = { v: TRANSFER_VERSION, sources };
  if (login) out.rutracker = { username: login.username.trim(), password: login.password };
  if (indexers && indexers.length) out.indexers = indexers.slice(0, MAX_TRANSFER_INDEXERS);
  return out;
}

/**
 * The phone's connections for the transfer; with `withKeys` each saved key is read from the encrypted storage (a key
 * that cannot be read, or one the TV would refuse, is left out and that connection goes without it).
 */
export function transferIndexers(conns: IndexerConn[], secrets: SecretStore | undefined, withKeys: boolean): Promise<TransferIndexer[]> {
  const list = conns.slice(0, MAX_TRANSFER_INDEXERS);
  return Promise.all(
    list.map((c) => {
      const base: TransferIndexer = { kind: c.kind, url: c.url };
      if (c.name) base.name = c.name;
      if (!withKeys || !c.keySet || !secrets) return Promise.resolve(base);
      return secrets.get(indexerKeyName(c.id)).then(
        (k) => {
          if (k && INDEXER_KEY.test(k)) base.key = k;
          return base;
        },
        () => base,
      );
    }),
  );
}

// ---- TV side ----

/** A connection in the TV's page event: `key` says a key was staged for it (never the key). */
export interface RemoteIndexer {
  kind: IndexerKind;
  url: string;
  name?: string;
  key: boolean;
}

/** The page event of a transfer (no password, no key in it). */
export interface RemoteSources {
  id: string;
  sources: { [id: string]: boolean };
  /** Transferred Jackett / Prowlarr connections (none = omitted). */
  indexers?: RemoteIndexer[];
  /** The login was sent and is staged in the encrypted storage (verified here, promoted by the native side). */
  rutracker: boolean;
  phone: string;
  /** When the TV received it (epoch ms), 0 when unknown. */
  at: number;
}

export function parseRemoteSources(d: unknown): RemoteSources | null {
  if (!isObject(d) || typeof d.id !== 'string' || !d.id || d.id.length > 64) return null;
  const sources = validSources(d.sources);
  if (!sources) return null;
  const phone = typeof d.phone === 'string' ? d.phone.replace(CONTROL_ALL, '').trim().slice(0, 64) : '';
  const at = typeof d.at === 'number' && isFinite(d.at) ? d.at : 0;
  const indexers: RemoteIndexer[] = [];
  if (d.indexers !== undefined) {
    if (!Array.isArray(d.indexers) || d.indexers.length > MAX_TRANSFER_INDEXERS) return null;
    for (let i = 0; i < d.indexers.length; i++) {
      const x = d.indexers[i];
      if (!isObject(x) || typeof x.key !== 'boolean') return null;
      const plain: { [k: string]: unknown } = { kind: x.kind, url: x.url };
      if (x.name !== undefined) plain.name = x.name;
      const base = validIndexer(plain);
      if (!base) return null;
      const r: RemoteIndexer = { kind: base.kind, url: base.url, key: x.key };
      if (base.name) r.name = base.name;
      indexers.push(r);
    }
  }
  const out: RemoteSources = { id: d.id, sources, rutracker: d.rutracker === true, phone: phone || 'Телефон', at };
  if (d.indexers !== undefined) out.indexers = indexers;
  return out;
}

/**
 * Saves the transferred connections on the TV: a staged key is moved from `indexer.pending.<i>.apikey` to the
 * connection's own entry (the native side drops whatever is left staged afterwards). Resolves how many connections
 * were saved; a connection whose key could not be moved is saved without it (the screen asks for the key).
 */
export function applyRemoteIndexers(r: RemoteSources, secrets: SecretStore | undefined): Promise<number> {
  let saved = 0;
  let chain: Promise<void> = Promise.resolve();
  (r.indexers || []).forEach((x, i) => {
    chain = chain.then(() => {
      const id = indexerId(x.kind, x.url);
      const move: Promise<boolean> =
        x.key && secrets
          ? secrets.get(indexerPendingKeyName(i)).then((k) => (k && INDEXER_KEY.test(k) ? secrets.set(indexerKeyName(id), k).then(() => true) : false))
          : Promise.resolve(false);
      return move
        .then(
          (keySet) => keySet,
          () => false,
        )
        .then((keySet) => {
          if (storeIndexer({ kind: x.kind, url: x.url, name: x.name }, keySet)) saved++;
        });
    });
  });
  return chain.then(() => saved);
}

/** Source ids of the transferred connections (the TV knows them once saved, even before its registry re-syncs). */
export function remoteIndexerSourceIds(r: RemoteSources): string[] {
  return (r.indexers || []).map((x) => INDEXER_SOURCE_PREFIX + indexerId(x.kind, x.url));
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

/** Tells the listeners again (after the native side promoted a verified login). */
export function notifyTransferApplied(): void {
  notify();
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
/** The rutracker note and state before a transfer, to restore when its verified login could not be stored. */
export interface LoginState {
  rutracker: boolean;
  health: SourceHealth | null;
}

export function loginState(): LoginState {
  const t = lastTransfer();
  return { rutracker: !!t && t.rutracker, health: getHealth('rutracker') };
}

/** The TV verified the phone's login but could not store it: it must not claim the login. */
export function transferLoginNotStored(prev: LoginState): void {
  const t = lastTransfer();
  if (t) saveJson(LAST_KEY, { at: t.at, phone: t.phone, rutracker: prev.rutracker });
  if (prev.health) setHealth('rutracker', prev.health);
  notify();
}

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
  remoteIndexerSourceIds(r).forEach((id) => {
    ids[id] = true;
  });
  Object.keys(r.sources).forEach((id) => {
    if (ids[id]) setSourceOn(id, r.sources[id]);
  });
  notify();
  const save = (rutracker: boolean) => {
    const prev = lastTransfer();
    // without a verified new login the earlier one stays, and so does the note about it
    saveJson(LAST_KEY, { at: now(), phone: r.phone, rutracker: rutracker || (!!prev && prev.rutracker) });
    notify();
  };
  if (!r.rutracker || !ids.rutracker) {
    save(false);
    return Promise.resolve(r.rutracker ? 'error' : undefined);
  }
  let p: Promise<void>;
  try {
    // the parser is a separate chunk (Android only), never part of the LG bundle
    const context = ctx();
    p = import('./rutracker').then((m) => m.rutrackerLoginPending(context));
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
      // the phone's login was not verified: the native side drops it, the TV keeps its earlier login and state
      save(false);
      return loginResult(e);
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

// «Передать на телевизор»: the phone sends its source switches (and, if asked, the rutracker login) to OMP on
// Android TV over the pairing channel (POST /omp/sources with the bearer token, android/.../control/ControlRouter.kt).
// The TV's native side checks the request, writes the login to the Keystore storage and hands the page
// `remoteSources { id, sources, rutracker, phone, indexers }` (never the password or an API key); the page applies the
// switches, signs in with the saved login and answers remoteSourcesDone { id, rutracker, indexers }.
// Jackett / Prowlarr connections travel with their API keys when the user leaves «вместе с ключами» on: the native side
// stages each key in the encrypted storage (`indexer.pending.<i>.apikey`) and the event says only `key: true`; the page
// moves it to the connection's own entry. The answer never echoes a key.
// The phone's FlareSolverr address and the sites' «Обходить проверку Cloudflare» switches travel too (plain settings).
// The logins of the other sites behind a login (Kinozal, rustorka…) travel in `logins` { siteId: { username, password } }
// (only LOGIN_SITES): the native side stages each under `<id>.pending.*`, the event says `logins: { id: true }`, the
// page checks each with Source.loginPending and answers `logins: { id: result }`; only a verified one is promoted,
// otherwise the TV keeps the login it had (the same staging as rutracker's).
// A site signed in through the browser (browserLogin.ts) travels as a session in `sessions`: the phone's native side
// adds that host's cookies and its User-Agent (OmpNative.siteSessionSend; they never pass through the page), the TV
// stages them, the event says `sessions: { id: host }`, the page checks each with Source.sessionPending and answers
// `sessions: { id: ok | error }`; only a verified session is promoted, otherwise the TV keeps what it had.
// The phone's resolved UI language travels as `language`; the TV stores it as its own language setting.
// Shared by the phone and the TV bundles: Chromium 53 rules.
import { isObject, loadJson, saveJson } from '../store/storage';
import { rutrackerBadLogin, rutrackerCaptcha } from './rutrackerText';
import { siteLoginCode } from './siteLoginText';
import { indexerId, indexerKeyName, indexerPendingKeyName, INDEXERS_MAX, INDEXER_SOURCE_PREFIX, NAME_MAX, normalizeIndexerUrl, storeIndexer } from './indexerStore';
import type { IndexerConn, IndexerKind } from './indexerStore';
import { clearHealth, getHealth, isCloudflareBypassOn, isSourceOn, setCloudflareBypass, setHealth, setSourceOn } from './store';
import { normalizeFlareUrl, setFlareSolverrUrl } from './flareStore';
import type { SecretStore, Source, SourceContext, SourceHealth } from './types';
import { updateSettings } from '../store/settings';
import { t } from '../i18n';
import type { Lang } from '../i18n';

export const TRANSFER_PATH = '/omp/sources';
export const TRANSFER_VERSION = 1;
// the same limits as ControlRouter (Kotlin)
export const MAX_TRANSFER_SOURCES = 40;
export const MAX_USERNAME = 100;
export const MAX_PASSWORD = 200;
export const MAX_TRANSFER_INDEXERS = INDEXERS_MAX;
export const MAX_INDEXER_URL = 200;
export const MAX_INDEXER_KEY = 200;
export const MAX_FLARE_URL = 200;
/** Body size the TV reads at most (ControlRouter MAX_BODY). */
export const MAX_TRANSFER_BYTES = 16384;
/** Printable ASCII without spaces: what Jackett and Prowlarr keys are made of. */
const INDEXER_KEY = /^[\x21-\x7e]{1,200}$/;
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
// C0, DEL and C1: the same set as Kotlin Char.isISOControl() in SourcesProtocol
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_ALL = /[\u0000-\u001f\u007f-\u009f]/g;
/**
 * Sites whose login may travel in `logins` (the same fixed list as SourcesProtocol.LOGIN_SITES in Kotlin): the id names
 * the TV's storage entries, so nothing else can be staged.
 */
export const LOGIN_SITES = ['kinozal', 'rustorka', 'nnmclub'];
/** Sites whose browser session may travel in `sessions` (SourcesProtocol.SESSION_SITES in Kotlin). */
export const SESSION_SITES = LOGIN_SITES.concat(['rutracker']);
const HOST = /^[a-z0-9]([a-z0-9-]{0,62}\.)+[a-z0-9-]{1,63}$/;
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
  /** The phone's FlareSolverr address (normal form). */
  flaresolverr?: string;
  /** «Обходить проверку Cloudflare» of every site behind Cloudflare (Source.cloudflare). */
  cloudflare?: { [id: string]: boolean };
  /** Logins of the other sites (LOGIN_SITES). */
  logins?: { [id: string]: TransferLogin };
  /** The phone's resolved UI language: the TV stores it as its own language setting. */
  language?: Lang;
}

/** What the TV answers about the rutracker login (and about each site's login in `logins`). */
export type RutrackerResult = 'ok' | 'bad_login' | 'captcha' | 'error';

const RESULTS: RutrackerResult[] = ['ok', 'bad_login', 'captcha', 'error'];

export function isRutrackerResult(v: unknown): v is RutrackerResult {
  return typeof v === 'string' && RESULTS.indexOf(v as RutrackerResult) >= 0;
}

/** The login as the TV accepts it (length and control characters), else null. */
export function validTransferLogin(v: unknown): TransferLogin | null {
  return validLogin(v);
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
  for (let i = 0; i < keys.length; i++) if (PAYLOAD_KEYS.indexOf(keys[i]) < 0) return null;
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
  if (v.flaresolverr !== undefined) {
    const flare = validFlare(v.flaresolverr);
    if (!flare) return null;
    out.flaresolverr = flare;
  }
  if (v.cloudflare !== undefined) {
    const cf = validSources(v.cloudflare);
    if (!cf) return null;
    out.cloudflare = cf;
  }
  if (v.logins !== undefined) {
    const l = validLogins(v.logins);
    if (!l) return null;
    out.logins = l;
  }
  if (v.language !== undefined) {
    if (!isLang(v.language)) return null;
    out.language = v.language;
  }
  return out;
}

function isLang(v: unknown): v is Lang {
  return v === 'ru' || v === 'en';
}

const PAYLOAD_KEYS = ['v', 'sources', 'rutracker', 'indexers', 'flaresolverr', 'cloudflare', 'logins', 'language'];

/** { siteId: { username, password } }: 1.. of LOGIN_SITES, no other fields. */
function validLogins(v: unknown): { [id: string]: TransferLogin } | null {
  if (!isObject(v)) return null;
  const ids = Object.keys(v);
  if (ids.length < 1 || ids.length > LOGIN_SITES.length) return null;
  const out: { [id: string]: TransferLogin } = {};
  for (let i = 0; i < ids.length; i++) {
    const x = v[ids[i]];
    if (LOGIN_SITES.indexOf(ids[i]) < 0 || !isObject(x)) return null;
    const keys = Object.keys(x);
    for (let k = 0; k < keys.length; k++) if (keys[k] !== 'username' && keys[k] !== 'password') return null;
    const login = validLogin(x);
    if (!login) return null;
    out[ids[i]] = login;
  }
  return out;
}

/** A FlareSolverr address already in its normal form (the TV saves it as it is). */
function validFlare(v: unknown): string | null {
  return typeof v === 'string' && v.length <= MAX_FLARE_URL && normalizeFlareUrl(v) === v ? v : null;
}

/**
 * The phone's switches of every source (on and off: the TV mirrors them), the login and the connections when given,
 * the Cloudflare switch of every site behind Cloudflare and the FlareSolverr address when one is saved.
 */
export function buildTransferPayload(
  list: Source[],
  login: TransferLogin | null,
  indexers?: TransferIndexer[],
  flare?: string | null,
  logins?: { [id: string]: TransferLogin } | null,
  /** The phone's resolved UI language. */
  language?: Lang,
): TransferPayload {
  const sources: { [id: string]: boolean } = {};
  const cloudflare: { [id: string]: boolean } = {};
  let cf = 0;
  list.forEach((s) => {
    if (!SOURCE_ID.test(s.id)) return;
    sources[s.id] = isSourceOn(s);
    if (s.cloudflare === true && cf < MAX_TRANSFER_SOURCES) {
      cloudflare[s.id] = isCloudflareBypassOn(s);
      cf++;
    }
  });
  const out: TransferPayload = { v: TRANSFER_VERSION, sources };
  if (login) out.rutracker = { username: login.username.trim(), password: login.password };
  if (indexers && indexers.length) out.indexers = indexers.slice(0, MAX_TRANSFER_INDEXERS);
  const f = flare ? normalizeFlareUrl(flare) : null;
  if (f) out.flaresolverr = f;
  if (cf) out.cloudflare = cloudflare;
  if (logins) {
    const l: { [id: string]: TransferLogin } = {};
    let n = 0;
    Object.keys(logins).forEach((id) => {
      if (LOGIN_SITES.indexOf(id) < 0) return;
      l[id] = { username: logins[id].username.trim(), password: logins[id].password };
      n++;
    });
    if (n) out.logins = l;
  }
  if (language) out.language = language;
  return out;
}

/**
 * The saved logins of the sites in LOGIN_SITES among `list` (Source.savedLogin), for the transfer; `only` limits it to
 * some sites (the site screen sends its own). A login that cannot be read is left out.
 */
export function transferLogins(list: Source[], ctx: SourceContext, only?: string[]): Promise<{ [id: string]: TransferLogin }> {
  const sites = list.filter((s) => LOGIN_SITES.indexOf(s.id) >= 0 && !!s.savedLogin && (!only || only.indexOf(s.id) >= 0));
  const out: { [id: string]: TransferLogin } = {};
  return Promise.all(
    sites.map((s) =>
      s.savedLogin!(ctx).then(
        (l) => {
          if (l) out[s.id] = l;
        },
        () => undefined,
      ),
    ),
  ).then(() => out);
}

/**
 * The payload without what an OMP on the TV older than v0.15 refuses (connections, FlareSolverr, Cloudflare switches,
 * site logins) and what one older than v0.16 refuses (the language).
 */
export function withoutNewParts(p: TransferPayload): TransferPayload {
  const out: TransferPayload = { v: p.v, sources: p.sources };
  if (p.rutracker) out.rutracker = p.rutracker;
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
  /** The phone's FlareSolverr address. */
  flaresolverr?: string;
  /** The sites' «Обходить проверку Cloudflare». */
  cloudflare?: { [id: string]: boolean };
  /** Sites (LOGIN_SITES) whose login was sent and is staged. */
  logins?: string[];
  /** Browser sessions staged natively (SESSION_SITES): the host each one is on (never a cookie). */
  sessions?: { [id: string]: string };
  /** The phone's resolved UI language. */
  language?: Lang;
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
  const out: RemoteSources = { id: d.id, sources, rutracker: d.rutracker === true, phone: phone || t('sources.defaultPhone'), at };
  if (d.indexers !== undefined) out.indexers = indexers;
  if (d.flaresolverr !== undefined) {
    const f = validFlare(d.flaresolverr);
    if (!f) return null;
    out.flaresolverr = f;
  }
  if (d.cloudflare !== undefined) {
    const cf = validSources(d.cloudflare);
    if (!cf) return null;
    out.cloudflare = cf;
  }
  if (d.logins !== undefined) {
    const l = d.logins;
    if (!isObject(l)) return null;
    const ids = Object.keys(l);
    for (let i = 0; i < ids.length; i++) if (LOGIN_SITES.indexOf(ids[i]) < 0 || l[ids[i]] !== true) return null;
    if (ids.length) out.logins = ids;
  }
  if (d.sessions !== undefined) {
    const x = d.sessions;
    if (!isObject(x)) return null;
    const ids = Object.keys(x);
    const sessions: { [id: string]: string } = {};
    for (let i = 0; i < ids.length; i++) {
      const h = x[ids[i]];
      if (SESSION_SITES.indexOf(ids[i]) < 0 || typeof h !== 'string' || h.length > 253 || !HOST.test(h)) return null;
      sessions[ids[i]] = h;
    }
    if (ids.length) out.sessions = sessions;
  }
  // an unknown language is ignored: the switches still apply
  if (isLang(d.language)) out.language = d.language;
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
  const code = siteLoginCode(e);
  if (code) return code;
  const msg = e instanceof Error ? e.message : '';
  if (msg === rutrackerBadLogin()) return 'bad_login';
  if (msg === rutrackerCaptcha()) return 'captcha';
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
  // only for the sites this TV knows to be behind Cloudflare
  const cfSites: { [id: string]: boolean } = {};
  known.forEach((s) => {
    if (s.cloudflare === true) cfSites[s.id] = true;
  });
  const cf = r.cloudflare || {};
  Object.keys(cf).forEach((id) => {
    if (cfSites[id]) setCloudflareBypass(id, cf[id]);
  });
  if (r.flaresolverr) setFlareSolverrUrl(r.flaresolverr);
  if (r.language) updateSettings({ language: r.language });
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

// ---- the other sites' logins on the TV ----

const SITES_KEY = 'tsp.sourcesTransferLogins';

function sitesFromPhone(): { [id: string]: true } {
  const v = loadJson<unknown>(SITES_KEY, {}, isObject);
  const out: { [id: string]: true } = {};
  if (isObject(v)) Object.keys(v).forEach((id) => {
    if (SESSION_SITES.indexOf(id) >= 0 && v[id] === true) out[id] = true;
  });
  return out;
}

/** The site's login on this TV came from the phone (the note «вход передан с телефона»). */
export function siteLoginFromPhone(id: string): boolean {
  return !!sitesFromPhone()[id];
}

function markSite(id: string, on: boolean): void {
  const m = sitesFromPhone();
  if (on) m[id] = true;
  else delete m[id];
  saveJson(SITES_KEY, m);
}

/** After a logout or a login typed on the TV the site's login is no longer «передан с телефона». */
export function forgetSiteLogin(id: string): void {
  if (siteLoginFromPhone(id)) markSite(id, false);
}

/** The notes and states of the sites before a transfer, to restore those whose verified login could not be stored. */
export interface SiteLoginsState {
  fromPhone: { [id: string]: true };
  health: { [id: string]: SourceHealth | null };
}

export function siteLoginsState(): SiteLoginsState {
  const health: { [id: string]: SourceHealth | null } = {};
  SESSION_SITES.forEach((id) => {
    health[id] = getHealth(id);
  });
  return { fromPhone: sitesFromPhone(), health };
}

/** The TV verified these sites' logins but could not store them: it must not claim them. */
export function siteLoginsNotStored(sites: string[], prev: SiteLoginsState): void {
  sites.forEach((id) => {
    if (SESSION_SITES.indexOf(id) < 0) return;
    markSite(id, !!prev.fromPhone[id]);
    const h = prev.health[id];
    if (h) setHealth(id, h);
  });
  notify();
}

/**
 * Checks the staged logins of the sites in the transfer (in parallel, each with one sign-in): resolves the result per
 * site. A site this TV does not know, or one without loginPending, is an «error» (the native side drops its login).
 */
export function applyRemoteLogins(r: RemoteSources, known: Source[], ctx: () => SourceContext): Promise<{ [id: string]: RutrackerResult }> {
  const out: { [id: string]: RutrackerResult } = {};
  const sites = r.logins || [];
  if (!sites.length) return Promise.resolve(out);
  return Promise.all(
    sites.map((id) => {
      const s = known.filter((x) => x.id === id)[0];
      let p: Promise<void>;
      try {
        p = s && s.loginPending ? s.loginPending(ctx()) : Promise.reject(new Error('unknown site'));
      } catch (e) {
        p = Promise.reject(e);
      }
      return p.then(
        () => {
          out[id] = 'ok';
          clearHealth(id);
          markSite(id, true);
        },
        (e: unknown) => {
          // not verified: the native side drops it, the TV keeps its earlier login and state
          out[id] = loginResult(e);
        },
      );
    }),
  ).then(() => {
    notify();
    return out;
  });
}

/**
 * Checks the browser sessions the phone sent (staged natively): each must be on one of the site's hosts and open the
 * site's check page signed in (Source.sessionPending). Resolves ok | error per site; only an «ok» is promoted natively.
 */
export function applyRemoteSessions(r: RemoteSources, known: Source[], ctx: () => SourceContext): Promise<{ [id: string]: 'ok' | 'error' }> {
  const out: { [id: string]: 'ok' | 'error' } = {};
  const sessions = r.sessions || {};
  const ids = Object.keys(sessions);
  if (!ids.length) return Promise.resolve(out);
  return Promise.all(
    ids.map((id) => {
      const s = known.filter((x) => x.id === id)[0];
      let p: Promise<void>;
      try {
        p = s && s.sessionPending ? s.sessionPending(ctx(), sessions[id]) : Promise.reject(new Error('unknown site'));
      } catch (e) {
        p = Promise.reject(e);
      }
      return p.then(
        () => {
          out[id] = 'ok';
          clearHealth(id);
          markSite(id, true);
        },
        () => {
          // not verified: the native side drops it, the TV keeps its earlier login and state
          out[id] = 'error';
        },
      );
    }),
  ).then(() => {
    notify();
    return out;
  });
}

/**
 * The phone's sites signed in through the browser among `list` (`only` limits it): their hosts, the active mirror first,
 * for OmpNative.siteSessionSend. A site whose state cannot be read is left out.
 */
export function transferSessions(list: Source[], ctx: SourceContext, only?: string[]): Promise<{ [id: string]: string[] }> {
  const sites = list.filter((s) => SESSION_SITES.indexOf(s.id) >= 0 && !!s.browserSession && !!s.sessionHosts && (!only || only.indexOf(s.id) >= 0));
  const out: { [id: string]: string[] } = {};
  return Promise.all(
    sites.map((s) =>
      s.browserSession!(ctx).then(
        (on) => {
          if (on) out[s.id] = s.sessionHosts!().slice(0, 10);
        },
        () => undefined,
      ),
    ),
  ).then(() => out);
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
      ? t('sources.today')
      : at >= start - 86400000 && at < start
        ? t('sources.yesterday')
        : two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear();
  return { day, time: two(d.getHours()) + ':' + two(d.getMinutes()) };
}

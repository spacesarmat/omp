// State of the trackers inside a Jackett / Prowlarr connection, for «Источники поиска» on the phone and Android TV.
// Jackett: the keyed Torznab list of configured indexers (t=indexers, it also proves the key), enriched with each
// indexer's last error from /api/v2.0/indexers when Jackett answers it. Prowlarr: /api/v1/system/status (version, key),
// /api/v1/indexer and /api/v1/indexerstatus. Results are kept in memory and refreshed when a screen opens or on a tap.
// The key is read per check and never logged or kept; native errors (they may hold a keyed URL) become generic texts.
// Chromium 53 safe; no parser import (the TV screen is part of the bundle that LG shares).
import { t as tr, tp } from '../i18n';
import { indexerKeyName } from './indexerStore';
import type { IndexerConn, IndexerKind } from './indexerStore';
import type { HttpOptions, SourceContext, SourceHttp } from './types';

/** unknown: the indexer did not tell (Jackett behind an admin password): never shown as working. */
export type TrackerState = 'ok' | 'error' | 'login' | 'cloudflare' | 'off' | 'unknown';

export interface TrackerStatus {
  name: string;
  state: TrackerState;
  /** Short reason of an error («не отвечает»). */
  detail?: string;
}

/** ok: answered; nokey: no key on this device; badkey: refused the key; down: no answer; error: other failure. */
export type ConnState = 'ok' | 'nokey' | 'badkey' | 'down' | 'error';

export interface IndexerStatus {
  state: ConnState;
  /** When it was checked, unix ms. */
  at: number;
  /** «2.1» (Prowlarr). */
  version?: string;
  trackers: TrackerStatus[];
  /** Russian text of a failure. */
  message?: string;
  /** Why the tracker states are not known («Jackett защищён паролем…»). */
  hint?: string;
}

export const jackettHiddenStates = (): string => tr('sources.indexer.hiddenStates');

export const statusNeedKey = (): string => tr('sources.indexer.needKey');
export const statusBadKey = (): string => tr('sources.indexer.badKey');
export const statusDown = (): string => tr('sources.indexer.down');
export const statusBadAnswer = (): string => tr('sources.indexer.badAnswer');
export const statusError = (status: number): string => tr('sources.indexer.error', { status });

const TIMEOUT_MS = 15000;
const MAX_CHARS = 2 * 1000 * 1000;
const MAX_TRACKERS = 200;
const NAME_MAX = 60;
const RECENT_FAILURE_MS = 60 * 60 * 1000;

type Get = (url: string, opts?: HttpOptions) => Promise<{ status: number; text: string }>;

function fail(state: ConnState, at: number, message: string): IndexerStatus {
  return { state, at, trackers: [], message };
}

/** A request whose native failure never passes its text on (it may hold the URL with the key). */
function getter(http: SourceHttp): Get {
  return (url, opts) =>
    http.get(url, opts).then(
      (r) => r,
      () => {
        throw new Error(statusDown());
      },
    );
}

class Stop {
  constructor(public status: IndexerStatus) {}
}

function check(res: { status: number; text: string }, at: number): void {
  if (res.status === 401 || res.status === 403) throw new Stop(fail('badkey', at, statusBadKey()));
  if (res.status < 200 || res.status >= 300) throw new Stop(fail('error', at, statusError(res.status)));
  if (res.text.length > MAX_CHARS) throw new Stop(fail('error', at, statusBadAnswer()));
}

function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    return undefined;
  }
}

/** The state of a tracker from Jackett's last error text (English, free form). */
export function jackettErrorState(error: unknown): { state: TrackerState; detail?: string } {
  const e = typeof error === 'string' ? error.trim() : '';
  if (!e) return { state: 'ok' };
  const t = e.toLowerCase();
  if (/cloudflare|challenge|flaresolverr|ddos-guard/.test(t)) return { state: 'cloudflare' };
  if (/login|log in|logged|credential|password|unauthori[sz]ed|captcha|cookie|auth/.test(t)) return { state: 'login' };
  if (/timed? ?out|timeout|no such host|name or service|connection|refused|unreachable|503|502|504/.test(t)) return { state: 'error', detail: tr('sources.state.noAnswer') };
  return { state: 'error' };
}

/** Jackett's keyed Torznab list of configured indexers: <indexers><indexer id configured><title>…; null = not that. */
export function parseJackettIndexers(xml: string): { id: string; name: string }[] | 'badkey' | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch (e) {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length || !doc.documentElement) return null;
  const root = doc.documentElement;
  if (root.localName === 'error') {
    const code = parseInt(root.getAttribute('code') || '', 10);
    return code >= 100 && code < 200 ? 'badkey' : null;
  }
  if (root.localName !== 'indexers') return null;
  const out: { id: string; name: string }[] = [];
  const list = root.getElementsByTagName('indexer');
  for (let i = 0; i < list.length && out.length < MAX_TRACKERS; i++) {
    const el = list[i];
    if (el.getAttribute('configured') === 'false') continue;
    let title = '';
    const kids = el.children;
    for (let k = 0; k < kids.length; k++) if (kids[k].localName === 'title') title = kids[k].textContent || '';
    const id = el.getAttribute('id') || '';
    const name = cleanName(title) || cleanName(id);
    if (name) out.push({ id, name });
  }
  return out;
}

/**
 * Last errors of Jackett's /api/v2.0/indexers JSON by indexer id ('' = no error); null when it is not that JSON or it
 * has no `last_error` field at all (an older Jackett): the states are then unknown.
 */
export function jackettErrors(text: string): { [id: string]: string } | null {
  const data = parseJson(text);
  const out: { [id: string]: string } = {};
  if (!Array.isArray(data)) return null;
  let known = false;
  data.slice(0, 1000).forEach((x) => {
    if (!x || typeof x !== 'object') return;
    const o = x as { [k: string]: unknown };
    if (typeof o.id !== 'string') return;
    if (typeof o.last_error === 'string') {
      out[o.id] = o.last_error;
      known = true;
    } else if (o.last_error === null || o.last_error === undefined) out[o.id] = '';
  });
  return known || !data.length ? out : null;
}

function checkJackett(base: string, key: string, get: Get, at: number): Promise<IndexerStatus> {
  const k = encodeURIComponent(key);
  const opts = { timeoutMs: TIMEOUT_MS };
  return get(base + '/api/v2.0/indexers/all/results/torznab/api?apikey=' + k + '&t=indexers&configured=true', opts).then((res) => {
    check(res, at);
    const list = parseJackettIndexers(res.text);
    if (list === 'badkey') return fail('badkey', at, statusBadKey());
    if (!list) return fail('error', at, statusBadAnswer());
    // the last error of each indexer is in the UI list, which Jackett answers only without an admin password
    return get(base + '/api/v2.0/indexers?configured=true&apikey=' + k, opts).then(
      (r) => (r.status === 200 && r.text.length <= MAX_CHARS ? jackettErrors(r.text) : null),
      () => null,
    ).then((errors) => {
      const trackers = list.map((t) => {
        // no evidence, no «работает»
        if (!errors || errors[t.id] === undefined) return { name: t.name, state: 'unknown' as TrackerState };
        const s = jackettErrorState(errors[t.id]);
        const out: TrackerStatus = { name: t.name, state: s.state };
        if (s.detail) out.detail = s.detail;
        return out;
      });
      const st: IndexerStatus = { state: 'ok', at, trackers };
      if (!errors && trackers.length) st.hint = jackettHiddenStates();
      return st;
    });
  });
}

/** «2.1.5.4925» → «2.1». */
export function shortVersion(v: unknown): string | undefined {
  const m = typeof v === 'string' ? /^(\d+)\.(\d+)/.exec(v.trim()) : null;
  return m ? m[1] + '.' + m[2] : undefined;
}

/** Prowlarr's indexers and their failures → tracker states (usenet indexers are left out). */
export function prowlarrTrackers(indexers: unknown, statuses: unknown, now: number): TrackerStatus[] {
  const failing: { [id: string]: { disabledTill: number; failure: number } } = {};
  if (Array.isArray(statuses)) {
    statuses.forEach((x) => {
      if (!x || typeof x !== 'object') return;
      const o = x as { [k: string]: unknown };
      if (typeof o.indexerId !== 'number') return;
      const till = typeof o.disabledTill === 'string' ? Date.parse(o.disabledTill) : NaN;
      const failure = typeof o.mostRecentFailure === 'string' ? Date.parse(o.mostRecentFailure) : NaN;
      // escalationLevel goes back to 0 after a success while mostRecentFailure stays
      const escalated = typeof o.escalationLevel !== 'number' || o.escalationLevel > 0;
      failing[String(o.indexerId)] = { disabledTill: isFinite(till) ? till : 0, failure: isFinite(failure) && escalated ? failure : 0 };
    });
  }
  const out: TrackerStatus[] = [];
  if (!Array.isArray(indexers)) return out;
  indexers.forEach((x) => {
    if (out.length >= MAX_TRACKERS || !x || typeof x !== 'object') return;
    const o = x as { [k: string]: unknown };
    if (typeof o.protocol === 'string' && o.protocol !== 'torrent') return;
    const name = cleanName(o.name);
    if (!name) return;
    if (o.enable === false) {
      out.push({ name, state: 'off' });
      return;
    }
    const f = failing[String(o.id)];
    // only a current failure: blocked until later, or failed within the last hour and not recovered since
    if (f && (f.disabledTill > now || (f.failure > 0 && now - f.failure < RECENT_FAILURE_MS))) {
      const t: TrackerStatus = { name, state: 'error' };
      if (f.disabledTill > now) t.detail = tr('sources.indexer.disabledAfterErrors');
      out.push(t);
      return;
    }
    out.push({ name, state: 'ok' });
  });
  return out;
}

function checkProwlarr(base: string, key: string, get: Get, at: number): Promise<IndexerStatus> {
  const opts = { headers: { 'X-Api-Key': key }, timeoutMs: TIMEOUT_MS };
  return get(base + '/api/v1/system/status', opts).then((res) => {
    check(res, at);
    const sys = parseJson(res.text);
    if (!sys || typeof sys !== 'object' || Array.isArray(sys)) return fail('error', at, statusBadAnswer());
    const version = shortVersion((sys as { version?: unknown }).version);
    return get(base + '/api/v1/indexer', opts).then((ir) => {
      check(ir, at);
      const indexers = parseJson(ir.text);
      if (!Array.isArray(indexers)) return fail('error', at, statusBadAnswer());
      return get(base + '/api/v1/indexerstatus', opts).then(
        (sr) => (sr.status === 200 && sr.text.length <= MAX_CHARS ? parseJson(sr.text) : []),
        () => [],
      ).then((statuses) => {
        const st: IndexerStatus = { state: 'ok', at, trackers: prowlarrTrackers(indexers, statuses, at) };
        if (version) st.version = version;
        return st;
      });
    });
  });
}

/**
 * Checks a connection with the given key (also before it is saved: «Проверить и подключить»). Never rejects: every
 * failure is a state with a Russian message.
 */
export function checkIndexer(conn: { kind: IndexerKind; url: string }, key: string, http: SourceHttp, now: () => number = Date.now): Promise<IndexerStatus> {
  const at = now();
  if (!key) return Promise.resolve(fail('nokey', at, statusNeedKey()));
  const get = getter(http);
  const run = conn.kind === 'jackett' ? checkJackett(conn.url, key, get, at) : checkProwlarr(conn.url, key, get, at);
  return run.then(
    (s) => s,
    (e: unknown) => {
      if (e instanceof Stop) return e.status;
      return e instanceof Error && e.message === statusDown() ? fail('down', at, statusDown()) : fail('error', at, statusBadAnswer());
    },
  );
}

// ---- cache ----

let cache: { [id: string]: IndexerStatus } = {};
let listeners: (() => void)[] = [];

export function getIndexerStatus(id: string): IndexerStatus | null {
  return cache[id] || null;
}

export function setIndexerStatus(id: string, s: IndexerStatus): void {
  cache[id] = s;
  listeners.slice().forEach((cb) => cb());
}

export function resetIndexerStatus(): void {
  cache = {};
}

/** Called on every status change; returns the unsubscribe. */
export function onIndexerStatus(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((x) => x !== cb);
  };
}

/**
 * Reads the saved key and checks the connection; the result is cached. A connection marked «ключ задан» whose key is
 * missing on this device (restored from a backup, or a transfer without keys) gets «нужен API-ключ», not «неверный».
 */
export function refreshIndexerStatus(conn: IndexerConn, ctx: SourceContext, now: () => number = Date.now): Promise<IndexerStatus> {
  const secrets = ctx.secrets;
  const key = secrets && conn.keySet ? secrets.get(indexerKeyName(conn.id)).then((k) => k || '', () => '') : Promise.resolve('');
  return key
    .then((k) => checkIndexer(conn, k, ctx.http, now))
    .then((s) => {
      setIndexerStatus(conn.id, s);
      return s;
    });
}

/** The key of a connection is really on this device (the «нужен API-ключ» line needs no network). */
export function hasIndexerKey(conn: IndexerConn, ctx: SourceContext): Promise<boolean> {
  if (!conn.keySet || !ctx.secrets) return Promise.resolve(false);
  return ctx.secrets.get(indexerKeyName(conn.id)).then((k) => !!k, () => false);
}

// ---- texts ----

export function workingCount(s: IndexerStatus): number {
  return s.trackers.filter((t) => t.state === 'ok').length;
}

/** «6 трекеров, 5 работают». */
export function summaryText(s: IndexerStatus): string {
  const n = s.trackers.length;
  if (!n) return tr('sources.indexer.noTrackers');
  if (s.trackers.every((t) => t.state === 'unknown')) return tp('sources.indexer.trackers', n) + ' · ' + tr('sources.state.unknown');
  const w = workingCount(s);
  return tp('sources.indexer.trackers', n) + ', ' + tp('sources.indexer.working', w);
}

const KIND: { [k in IndexerKind]: string } = { jackett: 'Jackett', prowlarr: 'Prowlarr' };

export function kindLabel(kind: IndexerKind): string {
  return KIND[kind];
}

/** «Prowlarr 2.1 · 9 трекеров, 8 работают» after a successful check. */
export function successText(kind: IndexerKind, s: IndexerStatus): string {
  return KIND[kind] + (s.version ? ' ' + s.version : '') + ' · ' + summaryText(s);
}

/** «Jackett · 192.168.1.191» (the saved name when there is one). */
export function connTitle(conn: { kind: IndexerKind; url: string; name?: string }): string {
  const m = /^https?:\/\/([^/:]+)/i.exec(conn.url);
  return (conn.name || KIND[conn.kind]) + (m ? ' · ' + m[1] : '');
}

/** State of a tracker: short on the phone («не отвечает»), long on the TV («ошибка: не отвечает»). */
export function trackerStateText(t: TrackerStatus, long?: boolean): string {
  switch (t.state) {
    case 'ok':
      return tr('sources.state.ok');
    case 'login':
      return tr('sources.state.login');
    case 'cloudflare':
      return 'Cloudflare';
    case 'unknown':
      return tr('sources.state.unknown');
    case 'off':
      return tr('sources.state.off');
    default:
      if (!t.detail) return tr('sources.state.error');
      return long ? tr('sources.state.errorDetail', { detail: t.detail }) : t.detail;
  }
}

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

export function trackerTone(t: TrackerStatus): Tone {
  if (t.state === 'ok') return 'ok';
  if (t.state === 'off' || t.state === 'unknown') return 'muted';
  if (t.state === 'error') return 'bad';
  return 'warn';
}

/** The line under a connection's name. */
export function connLine(s: IndexerStatus | null, on: boolean): { text: string; tone: Tone } {
  if (!s) return { text: on ? tr('sources.indexer.directChecking') : tr('sources.state.off'), tone: 'muted' };
  if (s.state === 'ok') {
    const rest = summaryText(s);
    return { text: on ? tr('sources.indexer.direct', { rest }) : tr('sources.indexer.offWith', { rest }), tone: on ? 'ok' : 'muted' };
  }
  if (s.state === 'nokey') return { text: tr('sources.indexer.noKeyLine'), tone: 'warn' };
  if (s.state === 'badkey') return { text: tr('sources.indexer.badKeyLine'), tone: 'bad' };
  if (s.state === 'down') return { text: tr('sources.state.noAnswer'), tone: 'bad' };
  return { text: s.message || tr('sources.state.error'), tone: 'bad' };
}

/** «Проверено 5 минут назад». */
export function checkedText(at: number, now: number = Date.now()): string {
  const min = Math.floor(Math.max(0, now - at) / 60000);
  if (min < 1) return tr('sources.indexer.justChecked');
  if (min < 60) return tp('sources.indexer.checkedMin', min);
  const h = Math.floor(min / 60);
  if (h < 24) return tp('sources.indexer.checkedHour', h);
  const d = Math.floor(h / 24);
  return tp('sources.indexer.checkedDay', d);
}

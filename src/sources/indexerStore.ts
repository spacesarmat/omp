// Connections to Jackett / Prowlarr: tsp.indexers [{ id, kind, url, keySet, name? }]. The API key is never here: it
// goes to the Android encrypted storage (SecretStore) under `indexer.<id>.apikey`. A backup keeps url + keySet only.
// Chromium 53 safe (shared by the phone and the TV bundles).
import { isObject, loadJson, saveJson } from '../store/storage';
import { t } from '../i18n';
import type { SecretStore } from './types';

export const INDEXERS_KEY = 'tsp.indexers';
export const INDEXERS_MAX = 20;
export const NAME_MAX = 40;

export type IndexerKind = 'jackett' | 'prowlarr';

export interface IndexerConn {
  id: string;
  kind: IndexerKind;
  /** Base address without a trailing slash, e.g. http://192.168.1.5:9117 (a reverse-proxy path is kept). */
  url: string;
  /** The API key is in the secret storage. */
  keySet: boolean;
  name?: string;
}

/** Name of the key in the secret storage. */
export function indexerKeyName(id: string): string {
  return 'indexer.' + id + '.apikey';
}

/** http(s) address cleaned of credentials, query, hash and trailing slashes; null when it is not an address. */
export function normalizeIndexerUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length > 200 || !/^https?:\/\/[^\s/?#@]+(?::\d{1,5})?(?:\/[^\s?#]*)?$/i.test(s.replace(/[?#].*$/, ''))) return null;
  const base = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const m = /^(https?):\/\/([^/]+)(\/.*)?$/i.exec(base);
  if (!m) return null;
  return m[1].toLowerCase() + '://' + m[2].toLowerCase() + (m[3] || '');
}

/** Lowercase host:port of an address with the default port made explicit; '' when not an address. */
export function hostKey(url: string): string {
  const m = /^(https?):\/\/([^/?#:@]+)(?::(\d+))?/i.exec(url || '');
  if (!m) return '';
  const port = m[3] || (m[1].toLowerCase() === 'https' ? '443' : '80');
  return m[2].toLowerCase() + ':' + port;
}

function hash32(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** Same address and kind give the same id (saving twice updates, never duplicates). */
export function indexerId(kind: IndexerKind, url: string): string {
  return kind + '-' + hash32(url);
}

function cleanName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return s || undefined;
}

export function sanitizeIndexers(v: unknown): IndexerConn[] {
  if (!Array.isArray(v)) return [];
  const out: IndexerConn[] = [];
  v.forEach((x) => {
    if (out.length >= INDEXERS_MAX || !isObject(x)) return;
    const kind = x.kind === 'jackett' || x.kind === 'prowlarr' ? x.kind : null;
    const url = normalizeIndexerUrl(x.url);
    if (!kind || !url) return;
    const id = indexerId(kind, url);
    if (out.some((c) => c.id === id)) return;
    const conn: IndexerConn = { id, kind, url, keySet: x.keySet === true };
    const name = cleanName(x.name);
    if (name) conn.name = name;
    out.push(conn);
  });
  return out;
}

let conns = sanitizeIndexers(loadJson<unknown>(INDEXERS_KEY, [], Array.isArray));
let listeners: (() => void)[] = [];

export function reloadIndexers(): void {
  conns = sanitizeIndexers(loadJson<unknown>(INDEXERS_KEY, [], Array.isArray));
  torznab = sanitizeHosts(loadJson<unknown>(TORZNAB_KEY, null, (x) => x === null || Array.isArray(x)));
  notify();
}

export function indexerConnections(): IndexerConn[] {
  return conns.map((c) => ({ ...c }));
}

export function getIndexer(id: string): IndexerConn | undefined {
  for (let i = 0; i < conns.length; i++) if (conns[i].id === id) return { ...conns[i] };
  return undefined;
}

/** Called after every change of the connections; returns the unsubscribe. */
export function onIndexersChange(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((x) => x !== cb);
  };
}

function notify(): void {
  listeners.slice().forEach((cb) => {
    try {
      cb();
    } catch (e) {
      /* a listener failure must not stop the others */
    }
  });
}

function persist(next: IndexerConn[]): void {
  conns = next;
  saveJson(INDEXERS_KEY, conns);
  notify();
}

export const indexerBadUrl = (): string => t('sources.indexer.badUrl');
export const indexerNoKey = (): string => t('sources.indexer.noKey');
export const indexerNoStore = (): string => t('sources.indexer.noStore');
export const indexerTooMany = (): string => t('sources.indexer.tooMany');

export interface IndexerInput {
  kind: IndexerKind;
  url: string;
  name?: string;
  /** New API key; omitted or empty keeps the saved one (an existing connection only). */
  apiKey?: string;
}

/**
 * Adds or updates a connection. The key is written to the secret storage first; when that fails nothing is saved and
 * the error is Russian. Rejects without touching storage when the address or the key is missing.
 */
export function saveIndexer(input: IndexerInput, secrets: SecretStore | undefined): Promise<IndexerConn> {
  const url = normalizeIndexerUrl(input.url);
  if (!url || (input.kind !== 'jackett' && input.kind !== 'prowlarr')) return Promise.reject(new Error(indexerBadUrl()));
  const id = indexerId(input.kind, url);
  const old = getIndexer(id);
  const key = (input.apiKey || '').trim();
  if (!key && !(old && old.keySet)) return Promise.reject(new Error(indexerNoKey()));
  if (!old && conns.length >= INDEXERS_MAX) return Promise.reject(new Error(indexerTooMany()));
  if (key && !secrets) return Promise.reject(new Error(indexerNoStore()));
  const write = key && secrets ? secrets.set(indexerKeyName(id), key) : Promise.resolve();
  return write.then(
    () => {
      const conn: IndexerConn = { id, kind: input.kind, url, keySet: true };
      const name = cleanName(input.name);
      if (name) conn.name = name;
      persist(old ? conns.map((c) => (c.id === id ? conn : c)) : conns.concat([conn]));
      return { ...conn };
    },
    () => {
      throw new Error(indexerNoStore());
    },
  );
}

/** Removes a connection and its key. */
export function removeIndexer(id: string, secrets: SecretStore | undefined): Promise<void> {
  const gone = secrets ? secrets.delete(indexerKeyName(id)).then(undefined, () => undefined) : Promise.resolve();
  return gone.then(() => {
    if (conns.some((c) => c.id === id)) persist(conns.filter((c) => c.id !== id));
  });
}

/** Search source id prefix of a connection (`indexer-<id>`): here so the TV transfer code needs no parser import. */
export const INDEXER_SOURCE_PREFIX = 'indexer-';

/** Name of a key the TV's native side staged during a transfer (entry `i` of the payload's indexers). */
export function indexerPendingKeyName(i: number): string {
  return 'indexer.pending.' + i + '.apikey';
}

/**
 * Adds or updates a connection without touching the secret storage (a transfer to the TV: its key, if any, is already
 * in place). `keySet` false keeps an existing connection's key. Null when the address is wrong or the list is full.
 */
export function storeIndexer(input: { kind: IndexerKind; url: string; name?: string }, keySet: boolean): IndexerConn | null {
  const url = normalizeIndexerUrl(input.url);
  if (!url || (input.kind !== 'jackett' && input.kind !== 'prowlarr')) return null;
  const id = indexerId(input.kind, url);
  const old = getIndexer(id);
  if (!old && conns.length >= INDEXERS_MAX) return null;
  const conn: IndexerConn = { id, kind: input.kind, url, keySet: keySet || (!!old && old.keySet) };
  const name = cleanName(input.name);
  if (name) conn.name = name;
  persist(old ? conns.map((c) => (c.id === id ? conn : c)) : conns.concat([conn]));
  return { ...conn };
}

// Torznab addresses in the TorrServer settings (host:port, hostKey form), read by the «Источники поиска» screens.
// Kept so the path selection survives a restart; hosts only, never keys. Unknown until first read.
const TORZNAB_KEY = 'tsp.torznabHosts';
const HOST_KEY = /^[a-z0-9.\-[\]:]{1,120}:\d{1,5}$/;

function sanitizeHosts(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  v.forEach((h) => {
    if (typeof h === 'string' && HOST_KEY.test(h) && out.indexOf(h) < 0 && out.length < INDEXERS_MAX) out.push(h);
  });
  return out;
}

let torznab: string[] | undefined = sanitizeHosts(loadJson<unknown>(TORZNAB_KEY, null, (x) => x === null || Array.isArray(x)));

/** Torznab hosts of the TorrServer settings; undefined = not known yet, [] = TorrServer has none. */
export function torznabHosts(): string[] | undefined {
  return torznab ? torznab.slice() : undefined;
}

/** Saves the TorrServer Torznab hosts (undefined forgets them) and tells the listeners (the path selection). */
export function setTorznabHosts(hosts: string[] | undefined): void {
  const next = hosts === undefined ? undefined : sanitizeHosts(hosts) || [];
  if (JSON.stringify(next) === JSON.stringify(torznab)) return;
  torznab = next;
  saveJson(TORZNAB_KEY, next === undefined ? null : next);
  notify();
}

export const torznabHidden = (): string => t('sources.indexer.torznabHidden');
export const torznabHiddenSameProwlarr = (): string => t('sources.indexer.torznabHiddenProwlarr');
export const torznabHiddenDirect = (): string => t('sources.indexer.torznabHiddenDirect');

/**
 * The note under «Через TorrServer» when ts-torznab is hidden (`hidden`): «тот же Jackett» only when the TorrServer
 * Torznab hosts are known and matched by direct connections; otherwise the plain reason. '' when not hidden.
 */
export function torznabHiddenText(hidden: boolean): string {
  if (!hidden) return '';
  const hosts = torznabHosts();
  if (!hosts || !hosts.length) return torznabHiddenDirect();
  const matched = conns.filter((c) => hosts.indexOf(hostKey(c.url)) >= 0);
  if (!matched.length) return torznabHiddenDirect();
  return matched.every((c) => c.kind === 'prowlarr') ? torznabHiddenSameProwlarr() : torznabHidden();
}

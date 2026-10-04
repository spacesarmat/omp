// Direct search through Jackett and Prowlarr (source kind 'indexer'), one source per saved connection.
// Jackett: Torznab XML from all configured trackers at once; Prowlarr: its JSON search with an X-Api-Key header.
// Android only (native http, like the built-in parsers): registered by registerBuiltinSources, never in the LG bundle.
// The API key is read from the secret storage per search and is never logged: errors are generic Russian texts, and
// a failed native request is replaced by one so that no URL (it carries the key for Jackett) can leak.
import { stashFile } from '../api/torrentFiles';
import { formatBytes } from '../lib/format';
import { infohashFromMagnet } from './html';
import { hostKey, indexerConnections, indexerKeyName, INDEXER_SOURCE_PREFIX, onIndexersChange, setTorznabHosts, torznabHosts } from './indexerStore';
import type { IndexerConn } from './indexerStore';
import { builtinSources, registerSource, setHideRule, unregisterSource } from './registry';
import { isSourceOn } from './store';
import type { Source, SourceContext, SourceResult } from './types';

export const INDEXER_BAD_KEY = 'Неверный API-ключ';
/** The connection says a key is set but this device has none (e.g. restored from a backup): enter it again. */
export const INDEXER_NEED_KEY = 'Нужен API-ключ';
export const INDEXER_DOWN = 'Индексатор не отвечает';
export const INDEXER_BAD_ANSWER = 'Индексатор ответил не так, как ожидалось';
export const INDEXER_ERROR = 'Индексатор ответил ошибкой ';

export const INDEXER_ID_PREFIX = INDEXER_SOURCE_PREFIX;
export const INDEXER_TIMEOUT_MS = 20000;
/** A longer answer is not parsed (a search over every tracker can be huge). */
export const INDEXER_MAX_CHARS = 5 * 1000 * 1000;
export const INDEXER_MAX_ITEMS = 500;
export const INDEXER_NO_FILE = 'Не удалось скачать файл раздачи';

const KEY_NAMES = ['jackett_apikey', 'apikey', 'api_key'];

/**
 * The URL without any API key parameter. Results never hold a keyed URL: they are saved in monitor findings and seen
 * keys, shown, copied and sent to TorrServer. The key is attached again in memory by Source.resolve.
 */
export function stripKey(url: string): string {
  const h = url.indexOf('#');
  const hash = h >= 0 ? url.slice(h) : '';
  const rest = h >= 0 ? url.slice(0, h) : url;
  const q = rest.indexOf('?');
  if (q < 0) return url;
  const kept = rest
    .slice(q + 1)
    .split('&')
    .filter((p) => p && KEY_NAMES.indexOf(p.split('=')[0].toLowerCase()) < 0);
  return rest.slice(0, q) + (kept.length ? '?' + kept.join('&') : '') + hash;
}

type Kind = 'jackett' | 'prowlarr';

const KIND_LABEL: { [k in Kind]: string } = { jackett: 'Jackett', prowlarr: 'Prowlarr' };

function num(v: string | null | undefined): number | undefined {
  if (v === null || v === undefined || !/^\s*\d+\s*$/.test(v)) return undefined;
  return parseInt(v, 10);
}

function firstNum(list: (string | null | undefined)[]): number | undefined {
  for (let i = 0; i < list.length; i++) {
    const n = num(list[i]);
    if (n !== undefined) return n;
  }
  return undefined;
}

function magnetFor(hash: string | undefined, title: string): string {
  return hash ? 'magnet:?xt=urn:btih:' + hash + '&dn=' + encodeURIComponent(title) : '';
}

interface Fields {
  title: string;
  tracker: string;
  sizeBytes?: number;
  date?: number;
  seeders?: number;
  leechers?: number;
  magnet?: string;
  hash?: string;
  /** .torrent download link (TorrServer downloads it when there is no magnet). */
  torrent?: string;
  detailUrl?: string;
  categories?: string;
}

function toResult(sourceId: string, f: Fields): SourceResult | null {
  if (!f.title) return null;
  let magnet = f.magnet && f.magnet.indexOf('magnet:') === 0 ? f.magnet : '';
  const hash = infohashFromMagnet(magnet) || f.hash;
  if (!magnet) magnet = magnetFor(hash, f.title);
  const link = !magnet && f.torrent && /^https?:\/\//i.test(f.torrent) ? stripKey(f.torrent) : '';
  if (!magnet && !link) return null;
  const detail = f.detailUrl && /^https?:\/\//i.test(f.detailUrl) ? stripKey(f.detailUrl) : '';
  const r: SourceResult = {
    Title: f.title,
    Categories: f.categories || '',
    Size: f.sizeBytes !== undefined ? formatBytes(f.sizeBytes) : '',
    CreateDate: f.date !== undefined ? new Date(f.date).toISOString() : '',
    Tracker: f.tracker,
    Link: link || detail,
    Magnet: magnet,
    Hash: hash || '',
    Peer: f.leechers || 0,
    Seed: f.seeders || 0,
    source: sourceId,
  };
  if (hash) r.hash = hash;
  if (detail) r.detailUrl = detail;
  if (f.date !== undefined) r.date = f.date;
  if (f.sizeBytes !== undefined) r.sizeBytes = f.sizeBytes;
  return r;
}

function trackerLabel(kind: Kind, indexer: string | undefined): string {
  const k = KIND_LABEL[kind];
  const n = (indexer || '').replace(/\s+/g, ' ').trim();
  return n ? k + ' · ' + n : k;
}

function child(el: Element, name: string): Element | null {
  const kids = el.children;
  for (let i = 0; i < kids.length; i++) if (kids[i].localName === name) return kids[i];
  return null;
}

function childText(el: Element, name: string): string {
  const c = child(el, name);
  return c ? (c.textContent || '').trim() : '';
}

/** Torznab/Newznab XML (Jackett, or a Prowlarr per-indexer feed) → results of source `sourceId`. */
export function parseTorznab(xml: string, sourceId: string, kind: Kind = 'jackett'): SourceResult[] {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch (e) {
    throw new Error(INDEXER_BAD_ANSWER);
  }
  if (doc.getElementsByTagName('parsererror').length) throw new Error(INDEXER_BAD_ANSWER);
  const root = doc.documentElement;
  if (!root) throw new Error(INDEXER_BAD_ANSWER);
  if (root.localName === 'error') {
    const code = parseInt(root.getAttribute('code') || '', 10);
    // Torznab: 100-199 are account/key errors
    if (code >= 100 && code < 200) throw new Error(INDEXER_BAD_KEY);
    throw new Error(INDEXER_BAD_ANSWER);
  }
  if (root.localName !== 'rss') throw new Error(INDEXER_BAD_ANSWER);
  const out: SourceResult[] = [];
  const items = doc.getElementsByTagName('item');
  for (let i = 0; i < items.length && i < INDEXER_MAX_ITEMS; i++) {
    const item = items[i];
    const attrs: { [name: string]: string } = {};
    const all = item.getElementsByTagName('*');
    for (let j = 0; j < all.length; j++) {
      const a = all[j];
      if (a.localName === 'attr') {
        const n = a.getAttribute('name');
        if (n && attrs[n] === undefined) attrs[n] = (a.getAttribute('value') || '').trim();
      }
    }
    const enclosure = child(item, 'enclosure');
    const link = childText(item, 'link');
    const enclosureUrl = enclosure ? (enclosure.getAttribute('url') || '').trim() : '';
    const magnet = attrs.magneturl || (link.indexOf('magnet:') === 0 ? link : '') || (enclosureUrl.indexOf('magnet:') === 0 ? enclosureUrl : '');
    const size = firstNum([attrs.size, childText(item, 'size'), enclosure ? enclosure.getAttribute('length') : null]);
    const date = Date.parse(childText(item, 'pubDate'));
    const seeders = num(attrs.seeders);
    const peers = num(attrs.peers);
    const leechers = num(attrs.leechers) !== undefined ? num(attrs.leechers) : peers !== undefined && seeders !== undefined ? Math.max(peers - seeders, 0) : peers;
    const hashAttr = (attrs.infohash || '').toLowerCase();
    const cats: string[] = [];
    const catEls = item.getElementsByTagName('category');
    for (let k = 0; k < catEls.length; k++) {
      const t = (catEls[k].textContent || '').trim();
      if (t && cats.indexOf(t) < 0) cats.push(t);
    }
    const indexer = childText(item, 'jackettindexer') || childText(item, 'prowlarrindexer');
    const plain = (u: string) => (u.indexOf('magnet:') === 0 ? '' : u);
    const r = toResult(sourceId, {
      title: childText(item, 'title'),
      tracker: trackerLabel(kind, indexer),
      sizeBytes: size,
      date: isFinite(date) ? date : undefined,
      seeders,
      leechers,
      magnet,
      hash: /^[0-9a-f]{40}$/.test(hashAttr) ? hashAttr : undefined,
      torrent: plain(enclosureUrl) || plain(link),
      detailUrl: childText(item, 'comments') || undefined,
      categories: cats.join(', '),
    });
    if (r) out.push(r);
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function nonNeg(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : undefined;
}

/** Prowlarr /api/v1/search JSON → results of source `sourceId` (usenet rows are skipped). */
export function parseProwlarr(text: string, sourceId: string): SourceResult[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(INDEXER_BAD_ANSWER);
  }
  if (!Array.isArray(data)) throw new Error(INDEXER_BAD_ANSWER);
  const out: SourceResult[] = [];
  data.slice(0, INDEXER_MAX_ITEMS).forEach((x) => {
    if (!x || typeof x !== 'object') return;
    const o = x as { [k: string]: unknown };
    if (typeof o.protocol === 'string' && o.protocol !== 'torrent') return;
    const guid = str(o.guid);
    const magnet = str(o.magnetUrl) || (guid.indexOf('magnet:') === 0 ? guid : '');
    const hashRaw = str(o.infoHash).toLowerCase();
    const date = Date.parse(str(o.publishDate));
    const r = toResult(sourceId, {
      title: str(o.title),
      tracker: trackerLabel('prowlarr', str(o.indexer)),
      sizeBytes: nonNeg(o.size),
      date: isFinite(date) ? date : undefined,
      seeders: nonNeg(o.seeders),
      leechers: nonNeg(o.leechers),
      magnet,
      hash: /^[0-9a-f]{40}$/.test(hashRaw) ? hashRaw : undefined,
      torrent: str(o.downloadUrl),
      detailUrl: str(o.infoUrl),
    });
    if (r) out.push(r);
  });
  return out;
}

/** Id of the source of a connection. */
export function indexerSourceId(conn: Pick<IndexerConn, 'id'>): string {
  return INDEXER_ID_PREFIX + conn.id;
}

function request(conn: IndexerConn, key: string, query: string, ctx: SourceContext) {
  const q = encodeURIComponent(query);
  const url =
    conn.kind === 'jackett'
      ? conn.url + '/api/v2.0/indexers/all/results/torznab/api?apikey=' + encodeURIComponent(key) + '&t=search&q=' + q
      : conn.url + '/api/v1/search?query=' + q + '&type=search';
  const opts = conn.kind === 'prowlarr' ? { headers: { 'X-Api-Key': key }, timeoutMs: INDEXER_TIMEOUT_MS } : { timeoutMs: INDEXER_TIMEOUT_MS };
  return ctx.http.get(url, opts).then(
    (res) => res,
    // the native error text may hold the URL (with the key): never pass it on
    () => {
      throw new Error(INDEXER_DOWN);
    },
  );
}

/** Latin-1 string (one char per byte) to bytes. */
function bytesOf(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

/**
 * The .torrent of a result that has no magnet: the keyless Link of the result gets the key back in memory, the file is
 * fetched through the native http (only from the connection's own host) and stashed for TorrServerClient.add, which
 * uploads it. The key reaches neither the result, TorrServer nor storage.
 */
function downloadTorrent(conn: IndexerConn, r: SourceResult, ctx: SourceContext): Promise<string> {
  const link = r.Link;
  if (!link || !/^https?:\/\//i.test(link) || hostKey(link) !== hostKey(conn.url)) return Promise.reject(new Error(INDEXER_NO_FILE));
  if (!ctx.secrets) return Promise.reject(new Error(INDEXER_BAD_KEY));
  return ctx.secrets.get(indexerKeyName(conn.id)).then(
    (key) => {
      if (!key) throw new Error(INDEXER_NEED_KEY);
      const keyed = conn.kind === 'jackett' ? link + (link.indexOf('?') < 0 ? '?' : '&') + 'jackett_apikey=' + encodeURIComponent(key) : link;
      const opts = { headers: conn.kind === 'prowlarr' ? { 'X-Api-Key': key } : undefined, timeoutMs: 30000, responseCharset: 'iso-8859-1' };
      return ctx.http.get(keyed, opts).then(
        (res) => {
          if (res.status === 401 || res.status === 403) throw new Error(INDEXER_BAD_KEY);
          // a bencoded dictionary starts with «d»
          if (res.status < 200 || res.status >= 300 || res.text.charAt(0) !== 'd') throw new Error(INDEXER_NO_FILE);
          return stashFile(bytesOf(res.text));
        },
        () => {
          throw new Error(INDEXER_DOWN);
        },
      );
    },
    () => {
      throw new Error(INDEXER_BAD_KEY);
    },
  );
}

/** The search source of one connection. */
export function indexerSource(conn: IndexerConn): Source {
  const id = indexerSourceId(conn);
  return {
    id,
    name: conn.name || KIND_LABEL[conn.kind],
    kind: 'indexer',
    resolve(r: SourceResult, ctx: SourceContext): Promise<string> {
      return downloadTorrent(conn, r, ctx);
    },
    search(query: string, ctx: SourceContext): Promise<SourceResult[]> {
      if (!ctx.secrets) return Promise.reject(new Error(INDEXER_BAD_KEY));
      return ctx.secrets.get(indexerKeyName(conn.id)).then(
        (key) => {
          if (!key) throw new Error(INDEXER_NEED_KEY);
          return request(conn, key, query, ctx).then((res) => {
            if (res.status === 401 || res.status === 403) throw new Error(INDEXER_BAD_KEY);
            if (res.status < 200 || res.status >= 300) throw new Error(INDEXER_ERROR + res.status);
            if (res.text.length > INDEXER_MAX_CHARS) throw new Error(INDEXER_BAD_ANSWER);
            return conn.kind === 'jackett' ? parseTorznab(res.text, id, 'jackett') : parseProwlarr(res.text, id);
          });
        },
        () => {
          throw new Error(INDEXER_BAD_KEY);
        },
      );
    },
  };
}

/**
 * Path selection: `ts-torznab` is hidden while direct connections (switched on) cover it. `tsHosts` are the host:port
 * of the Torznab addresses in the TorrServer settings: when known, it is hidden only when every one of them is
 * connected directly (a TorrServer with no Torznab address: any direct connection). Unknown (the settings were not
 * read yet): any enabled direct Jackett hides it. One search path, no duplicates.
 */
export function hidesTorznab(conns: IndexerConn[], tsHosts?: string | string[]): boolean {
  const on = conns.filter((c) => isSourceOn({ id: indexerSourceId(c) }));
  if (tsHosts === undefined) return on.some((c) => c.kind === 'jackett');
  const hosts = typeof tsHosts === 'string' ? [tsHosts] : tsHosts;
  if (!hosts.length) return on.length > 0;
  return hosts.every((h) => on.some((c) => hostKey(c.url) === h));
}

/** Host:port (one or several) of the TorrServer Torznab config when known (hostKey form); undefined = unknown. */
export function setTorznabHost(host: string | string[] | undefined): void {
  setTorznabHosts(host === undefined ? undefined : typeof host === 'string' ? [host] : host);
}

/** Registers a source per saved connection (replacing the previous ones) and installs the path selection. */
export function syncIndexerSources(): void {
  builtinSources().forEach((s) => {
    if (s.kind === 'indexer') unregisterSource(s.id);
  });
  indexerConnections().forEach((c) => registerSource(indexerSource(c)));
  setHideRule((sid) => sid === 'ts-torznab' && hidesTorznab(indexerConnections(), torznabHosts()));
}

let watching = false;

/** syncIndexerSources now and after every change of the connections. Called by registerBuiltinSources. */
export function startIndexerSources(): void {
  syncIndexerSources();
  if (watching) return;
  watching = true;
  onIndexersChange(syncIndexerSources);
}

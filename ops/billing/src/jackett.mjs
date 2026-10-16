import { createHash } from 'node:crypto';

export const JACKETT_MARK = 'omp-fetch:';
export const JACRED_MARK = 'omp-jacred:';

/** Per-indexer Torznab search cap. One slow tracker must not hold the rest. */
export const JACKETT_INDEXER_TIMEOUT_MS = 12000;
/** Whole POST /v1/search budget. The phone gives up at 25s, so this stays under that. */
export const JACKETT_SEARCH_DEADLINE_MS = 18000;
const INDEXER_LIST_TTL_MS = 10 * 60 * 1000;
const LIST_ATTEMPT_MS = 4000;
const MAX_INDEXERS = 100;
const MAX_BODY_CHARS = 2 * 1000 * 1000;
const MIN_REQUEST_MS = 50;

const EMPTY_TORZNAB =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed">' +
  '<channel><title>Jackett</title></channel></rss>';

/** Jackett or JacRed settings for a phone search (`source`) or a saved download link. */
export function indexerOf(settings, source) {
  const s = settings || {};
  if (source === 'jacred') {
    return { name: 'jacred', url: s.jacredUrl || '', key: s.jacredApiKey || '', mark: JACRED_MARK };
  }
  return { name: 'jackett', url: s.jackettUrl || '', key: s.jackettApiKey || '', mark: JACKETT_MARK };
}

export function indexerByLink(settings, link) {
  if (String(link || '').indexOf(JACRED_MARK) === 0) return indexerOf(settings, 'jacred');
  return indexerOf(settings, 'jackett');
}

/** Basic auth for an indexer that sits behind the panel proxy. Empty user means no header. */
export function basicAuthHeader(settings) {
  const user = String((settings || {}).indexerUser || '');
  if (!user) return '';
  const pass = String(settings.indexerPass || '');
  return 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
}

/** Removes the indexer key and replaces its origin so the phone never sees either. */
export function stripJackett(xml, origin, apiKey, mark) {
  let out = String(xml || '');
  const key = String(apiKey || '');
  if (key) out = out.split(key).join('');
  const base = String(origin || '').replace(/\/+$/, '');
  const prefix = mark || JACKETT_MARK;
  if (base) out = out.split(base).join(prefix);
  return out.replace(/([?&])(apikey|api_key|jackett_apikey)=[^&"'\s]*/gi, '$1');
}

/** `omp-fetch:/api/...` or `omp-jacred:/api/...` back into an indexer URL with the key attached. */
export function restoreJackett(link, origin, apiKey, mark) {
  const base = String(origin || '').replace(/\/+$/, '');
  const raw = String(link || '');
  const prefix = mark || JACKETT_MARK;
  if (raw.indexOf(prefix) !== 0 || !base) return '';
  let path = raw.slice(prefix.length);
  if (!path) return '';
  // no absolute / protocol-relative URLs, traversal, or backslashes - stay on the configured indexer origin
  if (path.indexOf('//') === 0 || /^https?:/i.test(path) || path.indexOf('://') >= 0 || path.indexOf('..') >= 0 || path.indexOf('\\') >= 0) {
    return '';
  }
  if (path.charAt(0) !== '/') path = '/' + path;
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/.test(path)) return '';
  let target;
  try {
    target = new URL(base + path);
  } catch {
    return '';
  }
  let originUrl;
  try {
    originUrl = new URL(base + '/');
  } catch {
    return '';
  }
  if (target.origin !== originUrl.origin) return '';
  // Search and the indexer admin API stay on /v1/search. A caller-chosen path must be a download.
  // jackettUrl may be https://host/jackett, so compare the path under that base, not the site root.
  const relative = pathWithinBase(target.pathname, originUrl.pathname);
  if (!relative || !isDownloadPath(relative)) return '';
  const key = encodeURIComponent(apiKey || '');
  return target.href + (target.search ? '&' : '?') + 'apikey=' + key;
}

/** `targetPath` with the configured base directory removed, or '' if it leaves that directory. */
function pathWithinBase(targetPath, basePath) {
  const base = String(basePath || '/').replace(/\/+$/, '');
  const full = String(targetPath || '/');
  if (!base) return full;
  if (full === base) return '/';
  if (full.indexOf(base + '/') !== 0) return '';
  return full.slice(base.length);
}

/** Jackett `/dl/…` and the per-indexer Torznab download route. `all` is the search API. */
function isDownloadPath(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  if (path.indexOf('%') >= 0 || path.indexOf('\\') >= 0 || path.indexOf('..') >= 0) return false;
  if (path === '/dl' || path.indexOf('/dl/') === 0) return /^\/dl(?:\/[A-Za-z0-9._~-]+)*$/.test(path);
  const download = /^\/api\/v2\.0\/indexers\/([A-Za-z0-9._~-]+)\/results\/torznab\/download$/.exec(path);
  return !!(download && download[1] !== 'all');
}

export function jackettSearchUrl(origin, apiKey, query) {
  const base = String(origin || '').replace(/\/+$/, '');
  return (
    base +
    '/api/v2.0/indexers/all/results/torznab/api?apikey=' +
    encodeURIComponent(apiKey || '') +
    '&t=search&q=' +
    encodeURIComponent(query || '')
  );
}

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function jackettIndexerTimeoutMs() {
  return positiveInt(process.env.BILLING_JACKETT_INDEXER_TIMEOUT_MS, JACKETT_INDEXER_TIMEOUT_MS);
}

export function jackettSearchDeadlineMs() {
  return positiveInt(process.env.BILLING_JACKETT_SEARCH_DEADLINE_MS, JACKETT_SEARCH_DEADLINE_MS);
}

/**
 * Catalog lookup vs per-indexer cap for one search.
 * Defaults: 12s per indexer, 6s to learn the list, 18s for the whole call.
 * A cached list skips the catalog wait, so a search then finishes in about 12s.
 * Each indexer is also cut at whatever time is left before the deadline.
 */
export function jackettSearchLimits(deadlineMs, indexerTimeoutMs) {
  const deadline = positiveInt(deadlineMs, JACKETT_SEARCH_DEADLINE_MS);
  const indexer = positiveInt(indexerTimeoutMs, JACKETT_INDEXER_TIMEOUT_MS);
  const reserve = Math.min(indexer, Math.floor((deadline * 2) / 3));
  let listMax = deadline - reserve;
  if (listMax > 6000) listMax = 6000;
  if (listMax < 0) listMax = 0;
  if (listMax > deadline) listMax = deadline;
  return { deadlineMs: deadline, indexerTimeoutMs: indexer, listMaxMs: listMax };
}

function indexerOrigin(origin) {
  return String(origin || '').replace(/\/+$/, '');
}

/** Jackett UI list. Fails closed when an admin password sits in front of it. */
export function jackettConfiguredIndexersUrl(origin, apiKey) {
  return indexerOrigin(origin) + '/api/v2.0/indexers?configured=true&apikey=' + encodeURIComponent(apiKey || '');
}

/** Torznab catalog (`t=indexers`), the same discovery surface as caps. Works with the API key alone. */
export function jackettTorznabIndexersUrl(origin, apiKey) {
  return (
    indexerOrigin(origin) +
    '/api/v2.0/indexers/all/results/torznab/api?apikey=' +
    encodeURIComponent(apiKey || '') +
    '&t=indexers&configured=true'
  );
}

/** One tracker's Torznab search. `all` is the aggregate that waits on the slowest indexer. */
export function jackettIndexerSearchUrl(origin, apiKey, indexerId, query) {
  return (
    indexerOrigin(origin) +
    '/api/v2.0/indexers/' +
    encodeURIComponent(indexerId) +
    '/results/torznab/api?apikey=' +
    encodeURIComponent(apiKey || '') +
    '&t=search&q=' +
    encodeURIComponent(query || '')
  );
}

function safeIndexerId(id) {
  return /^[A-Za-z0-9._~-]{1,80}$/.test(id) && id !== 'all' && id !== '.' && id !== '..';
}

function rememberIndexer(ids, id) {
  if (!safeIndexerId(id) || ids.indexOf(id) >= 0 || ids.length >= MAX_INDEXERS) return;
  ids.push(id);
}

function configuredAttr(attrs) {
  const match = /\bconfigured\s*=\s*"([^"]*)"/i.exec(attrs) || /\bconfigured\s*=\s*'([^']*)'/i.exec(attrs);
  return match ? String(match[1]).toLowerCase() : '';
}

function parseIndexerJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const ids = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || typeof row !== 'object') continue;
    if (row.configured === false || row.configured === 'false') continue;
    const id = typeof row.id === 'string' ? row.id : '';
    rememberIndexer(ids, id);
  }
  return ids;
}

function parseIndexerXml(text) {
  if (!/<indexers\b/i.test(text)) return null;
  const ids = [];
  const re = /<indexer\b([^>]*)\/?>/gi;
  let match;
  while ((match = re.exec(text))) {
    const attrs = match[1] || '';
    if (configuredAttr(attrs) === 'false') continue;
    const idMatch = /\bid\s*=\s*"([^"]*)"/i.exec(attrs) || /\bid\s*=\s*'([^']*)'/i.exec(attrs);
    if (!idMatch) continue;
    rememberIndexer(ids, idMatch[1]);
  }
  return ids;
}

/** Configured Jackett indexer ids from the JSON list or the Torznab catalog. `null` when it is neither. */
export function parseConfiguredIndexers(body) {
  const text = String(body || '')
    .replace(/^\uFEFF/, '')
    .slice(0, MAX_BODY_CHARS);
  if (!text.trim()) return null;
  const asJson = parseIndexerJson(text);
  if (asJson !== null) return asJson;
  return parseIndexerXml(text);
}

/** Join Torznab `<item>` rows into one feed. Error documents and empty channels add nothing. */
export function mergeTorznabFeeds(parts) {
  const items = [];
  const list = parts || [];
  for (let i = 0; i < list.length; i++) {
    const text = String(list[i] || '');
    if (/<error\b/i.test(text) && !/<item\b/i.test(text)) continue;
    const found = text.match(/<item\b[\s\S]*?<\/item>/gi);
    if (!found) continue;
    for (let j = 0; j < found.length; j++) items.push(found[j]);
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed">' +
    '<channel><title>Jackett</title>' +
    items.join('') +
    '</channel></rss>'
  );
}

function feedOk(status, text) {
  if (status < 200 || status >= 300) return false;
  const body = String(text || '');
  if (!body.trim() || body.length > MAX_BODY_CHARS) return false;
  if (/<error\b/i.test(body) && !/<item\b/i.test(body)) return false;
  return /<rss\b/i.test(body) || /<channel\b/i.test(body) || /<item\b/i.test(body);
}

export function createIndexerListCache(ttlMs) {
  const map = new Map();
  const inflight = new Map();
  const ttl = positiveInt(ttlMs, INDEXER_LIST_TTL_MS);
  return {
    get(key) {
      const row = map.get(key);
      if (!row) return null;
      if (Date.now() > row.exp) {
        map.delete(key);
        return null;
      }
      return row.ids.slice();
    },
    set(key, ids) {
      map.set(String(key), { ids: ids.slice(), exp: Date.now() + ttl });
    },
    load(key, fetcher) {
      const hit = this.get(key);
      if (hit) return Promise.resolve(hit);
      const pending = inflight.get(key);
      if (pending) return pending;
      const job = Promise.resolve()
        .then(() => fetcher())
        .then((ids) => {
          if (!Array.isArray(ids)) return null;
          this.set(key, ids);
          return this.get(key);
        })
        .catch(() => null)
        .finally(() => {
          if (inflight.get(key) === job) inflight.delete(key);
        });
      inflight.set(key, job);
      return job;
    },
  };
}

let indexerListCache = createIndexerListCache(INDEXER_LIST_TTL_MS);

export function jackettListCache() {
  return indexerListCache;
}

export function resetJackettListCache() {
  indexerListCache = createIndexerListCache(INDEXER_LIST_TTL_MS);
}

function listCacheKey(origin, apiKey) {
  const hash = createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 16);
  return indexerOrigin(origin) + '\0' + hash;
}

function logIndexerTimeouts(ids) {
  process.stderr.write('jackett indexer timeout: ' + ids.join(',') + '\n');
}

function fetchText(url, options) {
  const timeoutMs = Math.max(1, options.timeoutMs || 1);
  const fetchImpl = options.fetchImpl;
  const ctrl = new AbortController();
  let timer = null;
  const timed = new Promise((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve({ status: 0, text: '', aborted: true });
    }, timeoutMs);
  });
  const request = Promise.resolve()
    .then(() => fetchImpl(url, { headers: options.headers || {}, signal: ctrl.signal }))
    .then((res) => {
      if (!res || typeof res.text !== 'function') return { status: 0, text: '', aborted: false };
      return Promise.resolve(res.text()).then((text) => ({
        status: Number(res.status) || 0,
        text: String(text || ''),
        aborted: false,
      }));
    })
    .catch((err) => ({
      status: 0,
      text: '',
      aborted: !!(ctrl.signal.aborted || (err && err.name === 'AbortError')),
    }));
  return Promise.race([request, timed]).then((result) => {
    clearTimeout(timer);
    return result;
  });
}

function timeLeft(until) {
  const left = until - Date.now();
  if (left < MIN_REQUEST_MS) return 0;
  return left;
}

/**
 * Search each configured Jackett indexer on its own and drop the ones that fail or time out.
 * The configured list comes from `/api/v2.0/indexers?configured=true`, then the Torznab catalog.
 * @returns {Promise<{ ok: boolean, xml: string, timedOut: string[] }>}
 */
export async function searchJackett(opts) {
  const o = opts || {};
  const origin = indexerOrigin(o.origin);
  const apiKey = String(o.apiKey || '');
  const query = String(o.query || '');
  const headers = o.headers || {};
  const fetchImpl = o.fetchImpl || fetch;
  const cache = o.listCache || jackettListCache();
  const log = o.log || logIndexerTimeouts;
  const limits = jackettSearchLimits(
    positiveInt(o.deadlineMs, jackettSearchDeadlineMs()),
    positiveInt(o.indexerTimeoutMs, jackettIndexerTimeoutMs()),
  );
  if (!origin || !apiKey) return { ok: false, xml: '', timedOut: [] };

  const started = Date.now();
  const deadlineAt = started + limits.deadlineMs;
  const listUntil = started + limits.listMaxMs;
  const report = (ids) => {
    const seen = [];
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] && seen.indexOf(ids[i]) < 0) seen.push(ids[i]);
    }
    seen.sort();
    if (!seen.length) return seen;
    try {
      log(seen);
    } catch (e) {
      /* a log sink must not fail the search */
    }
    return seen;
  };

  let ids;
  try {
    ids = await cache.load(listCacheKey(origin, apiKey), async () => {
      const jsonTimeout = Math.min(LIST_ATTEMPT_MS, timeLeft(listUntil), timeLeft(deadlineAt));
      if (jsonTimeout) {
        const json = await fetchText(jackettConfiguredIndexersUrl(origin, apiKey), {
          headers,
          timeoutMs: jsonTimeout,
          fetchImpl,
        });
        if (!json.aborted && json.status >= 200 && json.status < 300) {
          const parsed = parseIndexerJson(String(json.text || '').slice(0, MAX_BODY_CHARS));
          if (parsed !== null) return parsed;
        }
      }
      const xmlTimeout = Math.min(LIST_ATTEMPT_MS, timeLeft(listUntil), timeLeft(deadlineAt));
      if (!xmlTimeout) return null;
      const xml = await fetchText(jackettTorznabIndexersUrl(origin, apiKey), {
        headers,
        timeoutMs: xmlTimeout,
        fetchImpl,
      });
      if (xml.aborted || xml.status < 200 || xml.status >= 300) return null;
      return parseIndexerXml(String(xml.text || '').slice(0, MAX_BODY_CHARS));
    });
  } catch (e) {
    ids = null;
  }
  if (!ids) return { ok: false, xml: '', timedOut: [] };
  if (!ids.length) return { ok: true, xml: EMPTY_TORZNAB, timedOut: [] };

  const rows = await Promise.all(
    ids.map(async (id) => {
      if (!safeIndexerId(id)) return { id, timedOut: false, feed: '' };
      const timeoutMs = Math.min(limits.indexerTimeoutMs, timeLeft(deadlineAt));
      if (!timeoutMs) return { id, timedOut: true, feed: '' };
      const res = await fetchText(jackettIndexerSearchUrl(origin, apiKey, id, query), {
        headers,
        timeoutMs,
        fetchImpl,
      });
      if (res.aborted) return { id, timedOut: true, feed: '' };
      if (!feedOk(res.status, res.text)) return { id, timedOut: false, feed: '' };
      return { id, timedOut: false, feed: res.text };
    }),
  );

  const timedOut = [];
  const feeds = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].timedOut) timedOut.push(rows[i].id);
    else if (rows[i].feed) feeds.push(rows[i].feed);
  }
  const logged = report(timedOut);
  if (!feeds.length) return { ok: false, xml: '', timedOut: logged };
  return { ok: true, xml: mergeTorznabFeeds(feeds), timedOut: logged };
}

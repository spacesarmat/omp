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
  return out.replace(/([?&])(apikey|api_key|jackett_apikey)=[^&"'<\s]*/gi, '$1');
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

/**
 * Torznab `cat` (audiobook search sends 3030). Only 4-digit ids, so a caller cannot
 * add extra query parameters. Empty when the phone did not ask for a category.
 */
export function safeTorznabCat(cat) {
  const raw = String(cat || '').trim();
  if (!raw) return '';
  if (!/^\d{4}(?:\s*,\s*\d{4})*$/.test(raw)) return '';
  return raw
    .split(',')
    .map((part) => part.trim())
    .join(',');
}

function appendCat(url, cat) {
  const c = safeTorznabCat(cat);
  if (!c) return url;
  return url + '&cat=' + encodeURIComponent(c);
}

export function jackettSearchUrl(origin, apiKey, query, cat) {
  const base = String(origin || '').replace(/\/+$/, '');
  return appendCat(
    base +
      '/api/v2.0/indexers/all/results/torznab/api?apikey=' +
      encodeURIComponent(apiKey || '') +
      '&t=search&q=' +
      encodeURIComponent(query || ''),
    cat,
  );
}

/**
 * A Latin JacRed answer this small is searched again. `matrix` hits the exact key
 * `matrix` (a couple of releases) and JacRed then skips the substring scan that would
 * open `thematrix`. Eight is below a real title bucket (Война миров was ~229) and
 * above a one-off exact name.
 */
export const JACRED_BROADEN_BELOW = 8;
/** Both JacRed calls together stay under the phone's 15s source timeout. */
export const JACRED_SEARCH_DEADLINE_MS = 12000;

const CYRILLIC = /[а-яё]/i;
const LATIN = /[a-z]/i;

/** JacRed `StringConvert.SearchName`: lower case, ё→е, щ→ш, letters and digits only. */
export function jacredSearchName(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/щ/g, 'ш')
    .replace(/[^a-zа-я0-9]+/g, '');
}

/**
 * A shorter Latin query that is not JacRed's exact FileDB key, so the substring scan runs.
 * Empty for Cyrillic, for `Title / Original` (JacRed already splits that), and for names
 * under 6 letters (the stem would be under 4). A trailing year is removed first, the way
 * JacRed's own `stripTrailingYear` does, so `matrix 1999` stems `matrix` rather than `matrix1999`.
 */
export function jacredBroaderQuery(query) {
  const raw = String(query || '').trim();
  if (!raw || raw.indexOf(' / ') >= 0) return '';
  let core = raw.replace(/\s+(?:19|20)\d{2}$/, '').trim();
  core = core.replace(/\b(?:s\d{1,2}e\d{1,2}|s\d{1,2}|e\d{1,2}|\d{1,2}x\d{1,2})\b/gi, ' ');
  core = core.replace(/\s*\d{1,2}(?:-\d{1,2})?\s*сезон\s*.*$/i, '').replace(/\s{2,}/g, ' ').trim();
  const name = jacredSearchName(core);
  if (!name || name.length < 6 || CYRILLIC.test(name) || !LATIN.test(name)) return '';
  return name.slice(0, name.length - 2);
}

function itemCount(xml) {
  const found = String(xml || '').match(/<item\b/gi);
  return found ? found.length : 0;
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
export function jackettIndexerSearchUrl(origin, apiKey, indexerId, query, cat) {
  return appendCat(
    indexerOrigin(origin) +
      '/api/v2.0/indexers/' +
      encodeURIComponent(indexerId) +
      '/results/torznab/api?apikey=' +
      encodeURIComponent(apiKey || '') +
      '&t=search&q=' +
      encodeURIComponent(query || ''),
    cat,
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
  const cat = o.cat;
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
      const res = await fetchText(jackettIndexerSearchUrl(origin, apiKey, id, query, cat), {
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

/**
 * Aggregate JacRed Torznab search (`t=search&q=`). No year or limit: JacRed applies those
 * only when the query sends them, and a missing `limit` is the whole list. `cat` is forwarded
 * when the phone sends one (audiobook search uses 3030) and omitted otherwise.
 * A thin Latin answer is fetched once more with `jacredBroaderQuery` and the feeds are merged.
 * A failed or slow second call keeps the first feed.
 * @returns {Promise<{ ok: boolean, xml: string }>}
 */
export async function searchJacRed(opts) {
  const o = opts || {};
  const origin = indexerOrigin(o.origin);
  const apiKey = String(o.apiKey || '');
  const query = String(o.query || '');
  const cat = o.cat;
  const headers = o.headers || {};
  const fetchImpl = o.fetchImpl || fetch;
  const deadlineMs = positiveInt(o.deadlineMs, JACRED_SEARCH_DEADLINE_MS);
  if (!origin || !apiKey) return { ok: false, xml: '' };

  const started = Date.now();
  const firstTimeout = Math.min(8000, deadlineMs);
  if (firstTimeout < MIN_REQUEST_MS) return { ok: false, xml: '' };
  const first = await fetchText(jackettSearchUrl(origin, apiKey, query, cat), {
    headers,
    timeoutMs: firstTimeout,
    fetchImpl,
  });
  if (first.aborted || !feedOk(first.status, first.text)) return { ok: false, xml: '' };

  const broader = jacredBroaderQuery(query);
  const left = deadlineMs - (Date.now() - started);
  if (!broader || itemCount(first.text) >= JACRED_BROADEN_BELOW || left < MIN_REQUEST_MS) {
    return { ok: true, xml: first.text };
  }
  const second = await fetchText(jackettSearchUrl(origin, apiKey, broader, cat), {
    headers,
    timeoutMs: left,
    fetchImpl,
  });
  if (second.aborted || !feedOk(second.status, second.text)) return { ok: true, xml: first.text };
  return { ok: true, xml: mergeTorznabFeeds([first.text, second.text]) };
}

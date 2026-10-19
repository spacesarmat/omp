// The full OMP changelog for the admin «Изменения» tab, «[tech]» bullets included.
// The billing image holds ops/billing only, so CHANGELOG.md / CHANGELOG.en.md are fetched from GitHub main,
// kept for CACHE_MS and served from the last good copy while GitHub does not answer.
// Bullet markers follow docs/changelog-markers.md: «[tech]» is admin-only, «[phone]» / «[tv]» / «[lg]» / «[atv]» say
// which app shows the bullet.

export const CHANGELOG_RAW_BASE = 'https://raw.githubusercontent.com/spacesarmat/omp/main/';
export const CHANGELOG_SOURCES = { ru: CHANGELOG_RAW_BASE + 'CHANGELOG.md', en: CHANGELOG_RAW_BASE + 'CHANGELOG.en.md' };
/** How long a fetched copy is served before GitHub is asked again. */
export const CHANGELOG_CACHE_MS = 10 * 60 * 1000;
/** After a failed fetch the next try waits this long, so a GitHub outage is not hammered on every tab open. */
export const CHANGELOG_RETRY_MS = 60 * 1000;
export const CHANGELOG_TIMEOUT_MS = 10 * 1000;
/** Larger answers are refused (the file is ~100 KB). */
export const CHANGELOG_MAX_BYTES = 2 * 1024 * 1024;

const TECH = /^\[tech\]\s*/i;
const PLATFORM = /^\[(tv|lg|atv|phone)\]\s*/i;
const UNRELEASED = /^(не выпущено|unreleased)$/i;

/**
 * Sections of a changelog in file order: `## <heading>` with its `- ` bullets. Each bullet without its marker, with
 * `tech` for «[tech]» and `platform` for «[phone]» / «[tv]» / «[lg]» / «[atv]» ('' when unmarked).
 * `### ` subheadings are flattened into their version; sections without bullets are dropped.
 */
export function parseChangelogSections(md) {
  const out = [];
  let cur = null;
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h && !/^###/.test(line)) {
      const heading = h[1].replace(/^v(?=\d)/, '');
      cur = { version: heading, unreleased: UNRELEASED.test(heading), beta: /-beta\./.test(heading), items: [] };
      out.push(cur);
      continue;
    }
    if (/^#\s/.test(line)) {
      cur = null;
      continue;
    }
    const b = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (!b || !cur) continue;
    let text = b[1];
    const tech = TECH.test(text);
    if (tech) text = text.replace(TECH, '');
    const p = PLATFORM.exec(text);
    const platform = p ? p[1].toLowerCase() : '';
    if (p) text = text.slice(p[0].length);
    cur.items.push({ text: text.replace(/\*\*(.+?)\*\*/g, '$1'), tech, platform });
  }
  return out.filter((s) => s.items.length > 0);
}

/** The body as text, at most CHANGELOG_MAX_BYTES bytes: a bigger answer is refused while it downloads. */
async function readLimited(res) {
  const len = Number((res.headers && typeof res.headers.get === 'function' && res.headers.get('content-length')) || 0);
  if (len > CHANGELOG_MAX_BYTES) throw new Error('too large');
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) {
    const text = await res.text();
    if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') > CHANGELOG_MAX_BYTES) throw new Error('too large');
    return text;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > CHANGELOG_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('too large');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

async function fetchText(net, url, timeoutMs) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await net(url, { headers: { accept: 'text/plain' }, signal: ctrl ? ctrl.signal : undefined });
    if (!res || !res.ok) throw new Error('HTTP ' + ((res && res.status) || 0));
    const text = await readLimited(res);
    if (typeof text !== 'string' || !text) throw new Error('empty');
    return text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The changelog source the admin route reads. `get()` resolves to
 * `{ ok, stale, fetchedAt, checkedAt, error, source, ru, en, enFetchedAt, enStale, enError }`: `ok` false only when
 * nothing was ever fetched, `stale` when the copy is older than the cache window because the last fetch failed.
 * The English file is tracked on its own: a failed English fetch keeps the previous English copy with `enStale`.
 * One fetch at a time; GitHub is asked at most once per CACHE_MS (once per RETRY_MS after a failure).
 */
export function createChangelogSource(opts = {}) {
  const net = opts.net || fetch;
  const now = opts.now || Date.now;
  const cacheMs = opts.cacheMs ?? CHANGELOG_CACHE_MS;
  const retryMs = opts.retryMs ?? CHANGELOG_RETRY_MS;
  const timeoutMs = opts.timeoutMs ?? CHANGELOG_TIMEOUT_MS;
  const sources = opts.sources || CHANGELOG_SOURCES;
  let good = null; // { ru, en, fetchedAt, enFetchedAt }
  let enError = '';
  let lastTry = 0;
  let lastError = '';
  let inflight = null;

  async function refresh() {
    lastTry = now();
    try {
      const ruText = await fetchText(net, sources.ru, timeoutMs);
      if (!/^# Изменения/.test(ruText)) throw new Error('not a changelog');
      const ru = parseChangelogSections(ruText);
      if (!ru.length) throw new Error('no versions');
      // the English file is optional: without it the tab shows Russian only
      let en = good ? good.en : [];
      let enFetchedAt = good ? good.enFetchedAt : 0;
      try {
        en = parseChangelogSections(await fetchText(net, sources.en, timeoutMs));
        enFetchedAt = now();
        enError = '';
      } catch (e) {
        // keep the previous English copy, marked stale in the view
        enError = String((e && e.name === 'AbortError' ? 'timeout' : e && e.message) || e || 'error');
      }
      good = { ru, en, fetchedAt: now(), enFetchedAt };
      lastError = '';
    } catch (e) {
      lastError = String((e && e.name === 'AbortError' ? 'timeout' : e && e.message) || e || 'error');
    }
  }

  function view() {
    const t = now();
    return {
      ok: !!good,
      stale: !!good && t - good.fetchedAt > cacheMs,
      fetchedAt: good ? good.fetchedAt : 0,
      checkedAt: lastTry,
      error: lastError,
      source: sources.ru,
      ru: good ? good.ru : [],
      en: good ? good.en : [],
      enFetchedAt: good ? good.enFetchedAt : 0,
      enStale: !!good && !!enError,
      enError,
    };
  }

  async function get() {
    const t = now();
    const fresh = good && t - good.fetchedAt <= cacheMs;
    const waiting = !!lastError && t - lastTry < retryMs;
    if (!fresh && !waiting) {
      if (!inflight) inflight = refresh().finally(() => (inflight = null));
      await inflight;
    }
    return view();
  }

  return { get };
}

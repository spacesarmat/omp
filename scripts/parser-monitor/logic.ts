// Parser monitor: the pure part (no network, no files). Classification of one check, the verdict of a source, the
// saved state between runs and what to alert (GitHub issue, Telegram), the weekly summary and the issue text.
// Unit-tested in tests/parserMonitor; the live runner (run.live.ts) and the alert sender (alerts.mjs) use it.

/** OK: the parser works. BROKEN: the site answers but the parser finds nothing / misses fields (a parser bug).
 *  BLOCKED: Cloudflare, 403/451, timeout, an anti-bot page — the site does not let the runner in (not a parser bug).
 *  PARTIAL: only the part that works without a login was checked (no credentials), or the release link step was blocked. */
export type Status = 'OK' | 'BROKEN' | 'BLOCKED' | 'PARTIAL';

/** What the fetcher saw last: enough to tell a block from a broken parser. */
export interface Page {
  status: number;
  url: string;
  text: string;
  cfMitigated?: string;
}

/** How a request or a parser failed (the live runner maps the thrown error to one of these). */
export type ErrorKind = 'timeout' | 'network' | 'challenge' | 'ipban' | 'login' | 'parse' | 'http' | 'other';

/** The fields a source's results must have. */
export interface Rules {
  /** Fewer results than this in one query = the query is broken. */
  minResults: number;
  /** Categories: every result has one, at least some do, or the site gives none. */
  category: 'all' | 'some' | 'none';
  /** What a result must carry to be added: a magnet, an http(s) .torrent link, or a release page (the app takes the
   *  link from it), or any of them. */
  link: 'magnet' | 'torrent' | 'detail' | 'any';
  /** At least one result has seeders > 0 (a popular query: all zeros means the seed column moved). */
  seedsAny: boolean;
}

/** The result fields the monitor looks at (a subset of SourceResult). */
export interface ResultLike {
  Title?: unknown;
  Size?: unknown;
  sizeBytes?: unknown;
  Seed?: unknown;
  Magnet?: unknown;
  Link?: unknown;
  detailUrl?: unknown;
  Categories?: unknown;
}

export interface Validation {
  ok: boolean;
  /** Short codes of what is missing, e.g. 'size', 'seeders', 'link', 'category', 'title'. */
  missing: string[];
  /** Share of results that have every required field. */
  validShare: number;
}

/** At least this share of the results must have every required field (one odd row is not a broken parser). */
export const VALID_SHARE = 0.9;

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isHttp = (v: unknown): boolean => isStr(v) && /^https?:\/\//i.test(v);
const isMagnet = (v: unknown): boolean => isStr(v) && /^magnet:\?/i.test(v) && /xt=urn:btih:[0-9a-z]{32,40}/i.test(v);

function linkOk(r: ResultLike, kind: Rules['link']): boolean {
  if (kind === 'magnet') return isMagnet(r.Magnet);
  if (kind === 'torrent') return isHttp(r.Link);
  if (kind === 'detail') return isMagnet(r.Magnet) || isHttp(r.detailUrl);
  return isMagnet(r.Magnet) || isHttp(r.Link) || isHttp(r.detailUrl);
}

/** Which required fields one result lacks. */
export function missingFields(r: ResultLike, rules: Rules): string[] {
  const out: string[] = [];
  if (!isStr(r.Title)) out.push('title');
  if (!isStr(r.Size) || typeof r.sizeBytes !== 'number' || !(r.sizeBytes > 0)) out.push('size');
  if (typeof r.Seed !== 'number' || !isFinite(r.Seed) || r.Seed < 0) out.push('seeders');
  if (!linkOk(r, rules.link)) out.push('link');
  if (rules.category === 'all' && !isStr(r.Categories)) out.push('category');
  return out;
}

export function validateResults(results: ResultLike[], rules: Rules): Validation {
  if (!results.length) return { ok: false, missing: [], validShare: 0 };
  const missing: { [k: string]: number } = {};
  let valid = 0;
  results.forEach((r) => {
    const m = missingFields(r, rules);
    if (!m.length) valid++;
    m.forEach((k) => (missing[k] = (missing[k] || 0) + 1));
  });
  const share = valid / results.length;
  const codes = Object.keys(missing).filter((k) => missing[k] / results.length > 1 - VALID_SHARE);
  if (rules.category === 'some' && !results.some((r) => isStr(r.Categories))) codes.push('category');
  if (rules.seedsAny && !results.some((r) => typeof r.Seed === 'number' && r.Seed > 0)) codes.push('seeders');
  const uniq = codes.filter((c, i) => codes.indexOf(c) === i).sort();
  return { ok: share >= VALID_SHARE && !uniq.length, missing: uniq, validShare: share };
}

/** Cloudflare's check page / Turnstile, or the cf-mitigated header. */
export function isChallengePage(p: Page): boolean {
  if ((p.cfMitigated || '').toLowerCase() === 'challenge') return true;
  const t = p.text || '';
  return t.indexOf('challenges.cloudflare.com') >= 0 || /<title>\s*Just a moment/i.test(t) || /cf-chl-|_cf_chl_opt/.test(t);
}

/** Statuses that mean «the site does not let us in» rather than «the page changed». */
export function isBlockStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status === 451 || status >= 500 || status === 0;
}

export interface CheckInput {
  /** What the check was, e.g. the query, «вход: страница логина», «магнет/торрент». */
  label: string;
  page?: Page | null;
  error?: { kind: ErrorKind; message: string } | null;
  results?: ResultLike[] | null;
  rules: Rules;
}

export interface Check {
  label: string;
  status: Status;
  /** Machine code of the outcome (part of the failure signature). */
  reason: string;
  /** Russian, for people. */
  detail: string;
  httpStatus?: number;
  results: number;
  /** A trimmed piece of the page (BROKEN only); filled by the runner. */
  snippet?: string;
}

const BLOCK_DETAIL: { [k: string]: string } = {
  timeout: 'таймаут',
  network: 'сеть недоступна',
  challenge: 'проверка Cloudflare',
  ipban: 'сайт показал страницу «введите проверочный код» (бан IP)',
};

/** One search query (or one step) → its status. */
export function classifyCheck(c: CheckInput): Check {
  const http = c.page ? c.page.status : undefined;
  const base = { label: c.label, httpStatus: http, results: c.results ? c.results.length : 0 };
  const err = c.error || null;
  if (err && (err.kind === 'timeout' || err.kind === 'network' || err.kind === 'ipban')) {
    return { ...base, status: 'BLOCKED', reason: err.kind, detail: BLOCK_DETAIL[err.kind] + (err.message && err.kind !== 'ipban' ? ': ' + err.message : '') };
  }
  if ((err && err.kind === 'challenge') || (c.page && isChallengePage(c.page))) {
    return { ...base, status: 'BLOCKED', reason: 'challenge', detail: BLOCK_DETAIL.challenge + (http ? ' (HTTP ' + http + ')' : '') };
  }
  if (c.page && isBlockStatus(c.page.status)) {
    return { ...base, status: 'BLOCKED', reason: 'http-' + c.page.status, detail: 'сайт ответил HTTP ' + c.page.status };
  }
  if (err && err.kind === 'login') {
    return { ...base, status: 'PARTIAL', reason: 'login', detail: 'нужен вход: ' + err.message };
  }
  if (err) {
    // the page loaded (2xx/3xx/4xx other than the blocks above) and the parser or a step threw
    const code = err.kind === 'parse' ? 'parse-error' : err.kind === 'http' ? 'http-' + (http || 0) : 'error';
    return { ...base, status: 'BROKEN', reason: code, detail: (err.kind === 'parse' ? 'парсер не нашёл таблицу результатов: ' : 'ошибка: ') + err.message };
  }
  const results = c.results || [];
  if (results.length < c.rules.minResults) {
    return { ...base, status: 'BROKEN', reason: 'too-few', detail: 'результатов ' + results.length + ', нужно не меньше ' + c.rules.minResults };
  }
  const v = validateResults(results, c.rules);
  if (!v.ok) {
    return {
      ...base,
      status: 'BROKEN',
      reason: 'missing:' + (v.missing.join(',') || 'fields'),
      detail: 'не хватает полей: ' + (v.missing.map(fieldName).join(', ') || 'разных') + ' (полных строк ' + Math.round(v.validShare * 100) + '%)',
    };
  }
  return { ...base, status: 'OK', reason: 'ok', detail: 'результатов ' + results.length };
}

const FIELD_NAMES: { [k: string]: string } = {
  title: 'название',
  size: 'размер',
  seeders: 'сиды',
  link: 'магнет/ссылка',
  category: 'категория',
};
export function fieldName(code: string): string {
  return FIELD_NAMES[code] || code;
}

export type LoginMode = 'none' | 'used' | 'missing' | 'failed';

export interface SourceReport {
  id: string;
  name: string;
  status: Status;
  /** Russian one-liner. */
  detail: string;
  /** none: the site needs no login; used: signed in with the repo secrets; missing: no secrets (anonymous checks only);
   *  failed: the secrets were refused (captcha / wrong password) — anonymous checks only. */
  login: LoginMode;
  checks: Check[];
  /** The release link step (magnet / .torrent) of one result, when the search worked. */
  link?: Check;
  /** ISO time of the check. */
  at: string;
}

/**
 * The verdict of a source from its checks. Search checks: BROKEN when at least half of them are BROKEN; else BLOCKED
 * when none is OK and some are blocked; else OK. A broken link step makes an OK search BROKEN, a blocked one PARTIAL.
 * Anonymous-only (login 'missing' / 'failed'): what would be OK is PARTIAL.
 */
export function sourceStatus(checks: Check[], link: Check | undefined, login: LoginMode): { status: Status; detail: string } {
  if (!checks.length) return { status: 'BROKEN', detail: 'нет проверок' };
  const broken = checks.filter((c) => c.status === 'BROKEN');
  const ok = checks.filter((c) => c.status === 'OK' || c.status === 'PARTIAL');
  const blocked = checks.filter((c) => c.status === 'BLOCKED');
  const anon = login === 'missing' || login === 'failed';
  const anonNote = login === 'failed' ? 'вход с секретами не удался, проверено без входа' : 'только без входа';
  if (broken.length >= Math.ceil(checks.length / 2)) {
    return { status: 'BROKEN', detail: broken[0].label + ': ' + broken[0].detail };
  }
  if (!ok.length && blocked.length) return { status: 'BLOCKED', detail: blocked[0].detail };
  if (link && link.status === 'BROKEN') return { status: 'BROKEN', detail: link.label + ': ' + link.detail };
  if (anon) return { status: 'PARTIAL', detail: anonNote };
  if (ok.some((c) => c.status === 'PARTIAL')) return { status: 'PARTIAL', detail: ok.filter((c) => c.status === 'PARTIAL')[0].detail };
  if (link && link.status === 'BLOCKED') return { status: 'PARTIAL', detail: link.label + ': ' + link.detail };
  return { status: 'OK', detail: ok.map((c) => c.results).join(' / ') + ' результатов' };
}

/** What a breakage looks like, to tell «the same failure again» from «it fails differently now». */
export function failureSignature(r: SourceReport): string {
  const parts = r.checks.filter((c) => c.status === 'BROKEN').map((c) => c.reason);
  if (r.link && r.link.status === 'BROKEN') parts.push('link:' + r.link.reason);
  return parts.filter((p, i) => parts.indexOf(p) === i).sort().join('|');
}

// ---------- state between runs ----------

export interface SourceState {
  status: Status;
  /** Runs in a row with this status. */
  streak: number;
  /** ISO time the status started. */
  since: string;
  /** An issue / Telegram alert is out for this breakage. */
  alerted: boolean;
  signature?: string;
  detail?: string;
}

export interface MonitorState {
  version: 1;
  updated?: string;
  sources: { [id: string]: SourceState };
  /** ISO week of the last weekly summary, e.g. '2026-W41'. */
  summaryWeek?: string;
}

export function emptyState(): MonitorState {
  return { version: 1, sources: {} };
}

/** A saved state from the JSON file; anything unknown becomes an empty state. */
export function parseState(raw: unknown): MonitorState {
  const st = emptyState();
  if (!raw || typeof raw !== 'object') return st;
  const o = raw as { sources?: unknown; summaryWeek?: unknown; updated?: unknown };
  if (typeof o.summaryWeek === 'string') st.summaryWeek = o.summaryWeek;
  if (typeof o.updated === 'string') st.updated = o.updated;
  const src = o.sources && typeof o.sources === 'object' ? (o.sources as { [k: string]: unknown }) : {};
  Object.keys(src).forEach((id) => {
    const s = src[id] as Partial<SourceState> | null;
    if (!s || typeof s !== 'object') return;
    if (s.status !== 'OK' && s.status !== 'BROKEN' && s.status !== 'BLOCKED' && s.status !== 'PARTIAL') return;
    st.sources[id] = {
      status: s.status,
      streak: typeof s.streak === 'number' && s.streak > 0 ? Math.floor(s.streak) : 1,
      since: typeof s.since === 'string' ? s.since : '',
      alerted: s.alerted === true,
      signature: typeof s.signature === 'string' ? s.signature : undefined,
      detail: typeof s.detail === 'string' ? s.detail : undefined,
    };
  });
  return st;
}

/** A BROKEN source is alerted after this many runs in a row. */
export const ALERT_AFTER = 2;

export type Action =
  | { kind: 'open'; source: string; title: string; body: string; telegram: string }
  | { kind: 'comment'; source: string; title: string; body: string }
  | { kind: 'close'; source: string; title: string; body: string; telegram: string }
  | { kind: 'telegram'; text: string };

/** Placeholder of the issue's address in a Telegram text (the sender knows it). */
export const ISSUE_LINK = '{issue}';

export function issueTitle(name: string): string {
  return 'Парсер ' + name + ' сломан';
}

export interface RunInfo {
  now: Date;
  /** Address of the workflow run, when known. */
  runUrl?: string;
  /** Send the weekly summary now (manual run). */
  forceSummary?: boolean;
}

/**
 * The next state and the alerts. BROKEN ALERT_AFTER runs in a row → open an issue + Telegram (once); still BROKEN but
 * failing differently → a comment; OK / PARTIAL again after an alert → close the issue + Telegram. BLOCKED never alerts
 * and keeps an open alert open (we cannot see the parser).
 */
export function decide(prev: MonitorState, reports: SourceReport[], run: RunInfo): { state: MonitorState; actions: Action[] } {
  const iso = run.now.toISOString();
  const next: MonitorState = { version: 1, updated: iso, sources: {}, summaryWeek: prev.summaryWeek };
  const actions: Action[] = [];
  reports.forEach((r) => {
    const p = prev.sources[r.id];
    const same = !!p && p.status === r.status;
    const s: SourceState = {
      status: r.status,
      streak: same ? p.streak + 1 : 1,
      since: same && p.since ? p.since : iso,
      alerted: !!p && p.alerted,
      signature: p ? p.signature : undefined,
      detail: r.detail,
    };
    const title = issueTitle(r.name);
    if (r.status === 'BROKEN') {
      const sig = failureSignature(r);
      if (!s.alerted && s.streak >= ALERT_AFTER) {
        s.alerted = true;
        s.signature = sig;
        actions.push({
          kind: 'open',
          source: r.id,
          title,
          body: issueBody(r, s, run),
          telegram: '🔴 Парсер ' + r.name + ' сломан (' + s.streak + ' проверки подряд): ' + clip(r.detail, 200) + '\n' + ISSUE_LINK,
        });
      } else if (s.alerted && sig !== s.signature) {
        s.signature = sig;
        actions.push({ kind: 'comment', source: r.id, title, body: '**Ошибка изменилась.**\n\n' + issueBody(r, s, run) });
      }
    } else if ((r.status === 'OK' || r.status === 'PARTIAL') && s.alerted) {
      s.alerted = false;
      s.signature = undefined;
      actions.push({
        kind: 'close',
        source: r.id,
        title,
        body: 'Парсер снова работает (' + statusWord(r.status) + ': ' + r.detail + '), ' + iso + '.' + (run.runUrl ? ' [Запуск](' + run.runUrl + ')' : ''),
        telegram: '✅ Парсер ' + r.name + ' снова работает: ' + clip(r.detail, 200) + '\n' + ISSUE_LINK,
      });
    }
    if (!s.signature) delete s.signature;
    next.sources[r.id] = s;
  });
  // an alerted source that is no longer checked keeps its record (its issue stays known)
  Object.keys(prev.sources).forEach((id) => {
    if (!next.sources[id] && prev.sources[id].alerted) next.sources[id] = prev.sources[id];
  });
  const week = isoWeek(run.now);
  if (run.forceSummary || summaryDue(prev.summaryWeek, run.now)) {
    actions.push({ kind: 'telegram', text: weeklySummary(reports) });
    next.summaryWeek = week;
  }
  return { state: next, actions };
}

// ---------- weekly summary ----------

/** ISO-8601 week of a date (UTC), e.g. '2026-W41'. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return year + '-W' + (week < 10 ? '0' : '') + week;
}

/**
 * The summary goes once a week, from the first run between Monday 06:00 and Tuesday 06:00 UTC. With runs at 00:17 and
 * 12:17 UTC that is the Monday 12:17 run — the one closest to 09:00. A week whose window had no run is skipped.
 */
export function summaryDue(lastWeek: string | undefined, now: Date): boolean {
  const day = now.getUTCDay();
  const h = now.getUTCHours();
  const inWindow = (day === 1 && h >= 6) || (day === 2 && h < 6);
  if (!inWindow) return false;
  // Tuesday before 06:00 still belongs to Monday's ISO week
  return lastWeek !== isoWeek(now);
}

const ICON: { [s: string]: string } = { OK: '✅', PARTIAL: '⚠️', BLOCKED: '🚫', BROKEN: '❌' };

export function statusWord(s: Status): string {
  return s === 'OK' ? 'работает' : s === 'PARTIAL' ? 'частично' : s === 'BLOCKED' ? 'блокирует GitHub' : 'сломан';
}

/** «Парсеры: ✅ rutor, ⚠️ rutracker (только без входа), 🚫 X (блокирует GitHub), ❌ Y (сломан)». */
export function weeklySummary(reports: SourceReport[]): string {
  const items = reports.map((r) => {
    let note = '';
    if (r.status === 'PARTIAL') note = r.login === 'missing' || r.login === 'failed' ? ' (только без входа)' : ' (частично)';
    else if (r.status === 'BLOCKED') note = ' (блокирует GitHub)';
    else if (r.status === 'BROKEN') note = ' (сломан)';
    return ICON[r.status] + ' ' + r.name + note;
  });
  return 'Парсеры: ' + items.join(', ');
}

// ---------- issue text and HTML snippet ----------

export function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Issue body: what failed, the query, HTTP status, the page piece, times. */
export function issueBody(r: SourceReport, s: SourceState, run: RunInfo): string {
  const lines: string[] = [];
  lines.push('Монитор парсеров: **' + r.name + '** (`' + r.id + '`) — ' + statusWord(r.status) + ' ' + s.streak + ' проверки подряд.');
  lines.push('');
  lines.push('- Сломан с: ' + (s.since || run.now.toISOString()));
  lines.push('- Проверено: ' + r.at);
  lines.push('- Вход: ' + loginWord(r.login));
  if (run.runUrl) lines.push('- Запуск: ' + run.runUrl);
  lines.push('');
  lines.push('| Проверка | Итог | HTTP | Результатов | Подробности |');
  lines.push('|---|---|---|---|---|');
  r.checks.concat(r.link ? [r.link] : []).forEach((c) => {
    lines.push('| ' + cell(c.label) + ' | ' + ICON[c.status] + ' ' + c.status + ' | ' + (c.httpStatus === undefined ? '—' : c.httpStatus) + ' | ' + c.results + ' | ' + cell(c.detail) + ' |');
  });
  const withSnippet = r.checks.concat(r.link ? [r.link] : []).filter((c) => c.status === 'BROKEN' && c.snippet);
  if (withSnippet.length) {
    const c = withSnippet[0];
    lines.push('');
    lines.push('<details><summary>Фрагмент страницы («' + cell(c.label) + '», до 3 КБ)</summary>');
    lines.push('');
    lines.push('```html');
    lines.push((c.snippet || '').replace(/```/g, '`‵`'));
    lines.push('```');
    lines.push('</details>');
  }
  lines.push('');
  lines.push('Issue закроется сам, когда парсер снова заработает. Что делать: docs/parser-monitor.md.');
  return lines.join('\n');
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function loginWord(l: LoginMode): string {
  return l === 'none' ? 'не нужен' : l === 'used' ? 'с секретами репозитория' : l === 'failed' ? 'секреты есть, вход не удался' : 'секретов нет, проверено без входа';
}

/** At most this many bytes (UTF-8) of page HTML go into an issue. */
export const SNIPPET_BYTES = 3072;

function utf8Len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? 2 : 3;
  }
  return n;
}

/** Cuts to `max` UTF-8 bytes, keeping surrogate pairs whole. */
export function cutBytes(s: string, max: number): string {
  if (utf8Len(s) <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (utf8Len(s.slice(0, mid)) <= max) lo = mid;
    else hi = mid - 1;
  }
  let end = lo;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return s.slice(0, end);
}

/**
 * Masks what must not go into a public issue: session ids and tokens in links and hidden fields, cookies, and any
 * of `secrets` (the login name of the monitor's account).
 */
export function redact(html: string, secrets: string[] = []): string {
  let out = html
    .replace(/\b(sid|hash4u|form_token|token|uid|pass|passkey|bb_session|session|PHPSESSID)=([^&"'\s<>;]+)/gi, '$1=***')
    .replace(/(<input[^>]*type=["']?hidden["']?[^>]*value=)("[^"]*"|'[^']*'|[^\s>]+)/gi, '$1"***"')
    .replace(/(<input[^>]*value=)("[^"]*"|'[^']*'|[^\s>]+)([^>]*type=["']?hidden)/gi, '$1"***"$3');
  secrets.forEach((s) => {
    if (s && s.length >= 3) out = out.split(s).join('***');
  });
  return out;
}

/**
 * A piece of the page (≤ SNIPPET_BYTES) around the first of `markers` the parser looks for, else the start of <body>.
 * Scripts, styles and comments are dropped and whitespace squeezed first; secrets are masked.
 */
export function makeSnippet(html: string, markers: string[], secrets: string[] = []): string {
  let text = (html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '<svg/>')
    .replace(/\s+/g, ' ');
  text = redact(text, secrets);
  let at = -1;
  for (let i = 0; i < markers.length && at < 0; i++) at = text.indexOf(markers[i]);
  if (at < 0) {
    const body = text.search(/<body\b/i);
    at = body >= 0 ? body : 0;
    return cutBytes(text.slice(at), SNIPPET_BYTES).trim();
  }
  // about a third before the marker, the rest after it
  const start = Math.max(0, at - 800);
  return cutBytes(text.slice(start), SNIPPET_BYTES).trim();
}

/** Markdown table of a run (the job summary and the local output). */
export function runTable(reports: SourceReport[]): string {
  const lines = ['| Источник | Итог | Вход | Подробности |', '|---|---|---|---|'];
  reports.forEach((r) => lines.push('| ' + r.name + ' | ' + ICON[r.status] + ' ' + r.status + ' | ' + r.login + ' | ' + cell(clip(r.detail, 160)) + ' |'));
  return lines.join('\n');
}

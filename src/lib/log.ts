// Error log shared by the phone and the TV bundles (Chromium 53 rules: no regex `u` flag / lookbehind,
// no AbortController, no Error subclasses). Ring buffer of LOG_MAX entries in `tsp.log`.
// Every text is scrubbed before it is stored: no URLs beyond scheme + site kind, no IPs, hashes, magnets,
// e-mails, secrets. Callers pass generic texts — never torrent titles.
import { signal } from '@preact/signals';
import { loadJson, saveJson, isObject } from '../store/storage';
import { APP_VERSION } from '../version';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogArea = 'app' | 'server' | 'search' | 'monitor' | 'tv' | 'install';

export const LOG_AREAS: LogArea[] = ['app', 'server', 'search', 'monitor', 'tv', 'install'];
export const LOG_MAX = 500;
export const LOG_TEXT_MAX = 300;
export const LOG_KEY = 'tsp.log';
/** The same entry again within this time is dropped. */
export const DUP_MS = 30000;

export const LEVEL_LABEL: { [k in LogLevel]: string } = { info: 'ИНФО', warn: 'ВНИМАНИЕ', error: 'ОШИБКА' };
export const AREA_LABEL: { [k in LogArea]: string } = {
  app: 'приложение',
  server: 'сервер',
  search: 'поиск',
  monitor: 'мониторинг',
  tv: 'ТВ',
  install: 'установка',
};

export interface LogEntry {
  /** Unix ms. */
  t: number;
  l: LogLevel;
  a: LogArea;
  x: string;
}

// ---- scrubbing ----

/** Source sites are not personal: their names stay in scrubbed URLs. */
const KNOWN_SITES: [string, string][] = [
  ['rutracker', 'rutracker'],
  ['rutor', 'rutor'],
  ['nnmclub', 'nnmclub'],
  ['nnm-club', 'nnmclub'],
  ['torrent.by', 'torrentby'],
  ['anidub', 'anidub'],
  ['bigfangroup', 'bigfangroup'],
  ['github.com', 'github'],
];

function hostKind(host: string): string {
  const h = host.toLowerCase();
  for (let i = 0; i < KNOWN_SITES.length; i++) if (h.indexOf(KNOWN_SITES[i][0]) >= 0) return KNOWN_SITES[i][1];
  return 'сервер';
}

const MAGNET = /magnet:\?[^\s"'<>]*/gi;
const COOKIE_LINE = /\b(set-cookie|cookie)\s*:[^\n]*/gi;
const AUTH_TOKEN = /\b(Basic|Bearer)\s+[A-Za-z0-9+\/=._-]+/g;
const JSON_SECRET = /"(password|passwd|pass|token|cookie|api_?key|secret)"\s*:\s*"[^"]*"/gi;
// key=value or key: value
const SECRET_COLON = /\b(password|passwd|pass|token|api_?key|apikey|secret|bb_session)\s*[=:]\s*("[^"]*"|[^\s&"',;<>]*)/gi;
// key=value only (these words are common in plain text)
const SECRET_EQ = /\b(login|user|username|sid|session|auth)=("[^"]*"|[^\s&"',;<>]*)/gi;
const URL_RE = /\b([a-z][a-z0-9+.-]*):\/\/([^\s\/?#"'<>)]*)[^\s"'<>)]*/gi;
const FILE_PATH = /(^|[\s"'(])\/(storage|sdcard|data|mnt|home|Users)\/[^"'\n)]*/g;
const RESOLVE_HOST = /(resolve host\s*)("[^"]*"|[^\s:,]+)/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const HASH = /\b(?:1220[0-9a-fA-F]{64}|[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?)\b/g;
const BASE32 = /\b[A-Z2-7]{32}\b/g;
const IP6_SHORT = /\[?(?:[0-9a-fA-F]{0,4}:){1,7}:[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{1,4}){0,6}(?:%[\w.]+)?\]?(?::\d{1,5})?/g;
const IP6_FULL = /\[?\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b\]?(?::\d{1,5})?/g;
const IP = /\b(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(:\d{1,5})?\b/g;
const LOCAL_HOST = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:local|lan|home|internal|localdomain)\b(?::\d{1,5})?/gi;
const HOST_PORT = /\b[a-z][a-z0-9-]*(?:(?:\.[a-z0-9-]+)+:\d{3,5}|:\d{4,5})\b/gi;
// Java: "host/192.168.1.5"
const HOST_SLASH_IP = /\b[a-z][a-z0-9-]*(?=\/(?:\d{1,3}\.){3}\d{1,3})/gi;
const CODE_EXT = /\.(js|ts|tsx|jsx|kt|java|json|css|html|map)(:\d+)?$/i;
const QUERY = /\?[^\s"'<>]*=[^\s"'<>]*/g;

/** Removes everything personal from a text and caps its length. */
export function scrub(text: string): string {
  let s = String(text == null ? '' : text);
  s = s.replace(MAGNET, 'magnet');
  s = s.replace(COOKIE_LINE, '$1: ***');
  s = s.replace(AUTH_TOKEN, '$1 ***');
  s = s.replace(JSON_SECRET, '"$1":"***"');
  s = s.replace(SECRET_COLON, '$1=***');
  s = s.replace(SECRET_EQ, '$1=***');
  s = s.replace(URL_RE, (_m, scheme: string, host: string) => {
    const at = host.lastIndexOf('@');
    return scheme.toLowerCase() + '://' + hostKind(at >= 0 ? host.slice(at + 1) : host);
  });
  s = s.replace(FILE_PATH, '$1файл');
  s = s.replace(RESOLVE_HOST, '$1"сервер"');
  s = s.replace(EMAIL, 'e-mail');
  s = s.replace(HASH, 'hash');
  s = s.replace(BASE32, 'hash');
  s = s.replace(IP6_FULL, 'IP');
  s = s.replace(IP6_SHORT, 'IP');
  s = s.replace(LOCAL_HOST, (m) => hostKind(m));
  s = s.replace(HOST_PORT, (m) => (CODE_EXT.test(m) || /^[0-9.]+:/.test(m) ? m : hostKind(m)));
  s = s.replace(HOST_SLASH_IP, 'сервер');
  s = s.replace(IP, 'IP');
  s = s.replace(QUERY, '?…');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > LOG_TEXT_MAX) s = s.slice(0, LOG_TEXT_MAX - 1) + '…';
  return s;
}

// ---- storage ----

function isLevel(v: unknown): v is LogLevel {
  return v === 'info' || v === 'warn' || v === 'error';
}

function isArea(v: unknown): v is LogArea {
  return LOG_AREAS.indexOf(v as LogArea) >= 0;
}

/** Well-formed entries only (texts are scrubbed again), last LOG_MAX. */
export function sanitizeLog(raw: unknown): LogEntry[] {
  const out: LogEntry[] = [];
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (!isObject(e)) continue;
    if (typeof e.t !== 'number' || !isFinite(e.t) || e.t <= 0 || !isLevel(e.l) || !isArea(e.a) || typeof e.x !== 'string') continue;
    out.push({ t: e.t, l: e.l, a: e.a, x: scrub(e.x) });
  }
  return out.length > LOG_MAX ? out.slice(out.length - LOG_MAX) : out;
}

function readStored(): LogEntry[] {
  return sanitizeLog(loadJson<unknown>(LOG_KEY, [], Array.isArray));
}

/** Union by (time, level, area, text), oldest first, the newest LOG_MAX. Stable without relying on Array.sort. */
export function mergeEntries(a: LogEntry[], b: LogEntry[]): LogEntry[] {
  const seen: { [k: string]: boolean } = {};
  const all: { e: LogEntry; i: number }[] = [];
  a.concat(b).forEach((e) => {
    const k = e.t + '|' + e.l + '|' + e.a + '|' + e.x;
    if (seen[k]) return;
    seen[k] = true;
    all.push({ e, i: all.length });
  });
  all.sort((p, q) => p.e.t - q.e.t || p.i - q.i);
  const out = all.map((p) => p.e);
  return out.length > LOG_MAX ? out.slice(out.length - LOG_MAX) : out;
}

let entries: LogEntry[] = sanitizeLog(loadJson<unknown>(LOG_KEY, [], Array.isArray));

/** Bumps on every change, so screens can re-read the log. */
export const logVersion = signal(0);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Writes the log to storage now (also called when the page is hidden). */
export function flushLog(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // the background monitor page and the app share the key: merge what the other one wrote
  entries = mergeEntries(readStored(), entries);
  saveJson(LOG_KEY, entries);
}

function scheduleSave(): void {
  if (saveTimer !== null) return;
  saveTimer = setTimeout(flushLog, 1000);
}

/** Appends an entry; never throws. Text must be generic (no torrent titles). */
export function log(level: LogLevel, area: LogArea, text: string): void {
  try {
    if (!isLevel(level) || !isArea(area)) return;
    const x = scrub(text);
    const now = Date.now();
    const last = entries[entries.length - 1];
    // a failure repeating every poll would flood the buffer
    if (last && last.l === level && last.a === area && last.x === x && now - last.t < DUP_MS) return;
    entries.push({ t: now, l: level, a: area, x });
    if (entries.length > LOG_MAX) entries = entries.slice(entries.length - LOG_MAX);
    logVersion.value = logVersion.value + 1;
    scheduleSave();
  } catch (e) {
    /* logging must never break the app */
  }
}

/** Oldest first. */
export function logEntries(): LogEntry[] {
  return entries.slice();
}

export function clearLog(): void {
  entries = [];
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveJson(LOG_KEY, entries);
  logVersion.value = logVersion.value + 1;
}

/** Picks up entries another page wrote (the background monitor), keeping the unsaved ones of this page. */
export function reloadLog(): void {
  entries = mergeEntries(readStored(), entries);
  logVersion.value = logVersion.value + 1;
}

// ---- device info ----

export interface LogInfo {
  version: string;
  platform: string;
  android?: string;
  model?: string;
  webview?: string;
}

/** Android version, model and WebView major from a user agent. */
export function parseUserAgent(ua: string): { android?: string; model?: string; webview?: string } {
  const out: { android?: string; model?: string; webview?: string } = {};
  const a = /Android (\d+(?:\.\d+)*)/.exec(ua);
  if (a) out.android = a[1];
  const m = /Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/.exec(ua);
  if (m && m[1].trim() && m[1].trim() !== 'K') out.model = m[1].trim();
  const w = /Chrome\/(\d+)/.exec(ua);
  if (w) out.webview = w[1];
  return out;
}

export function currentLogInfo(platform: string): LogInfo {
  let ua = '';
  try {
    ua = navigator.userAgent || '';
  } catch (e) {
    /* no navigator */
  }
  const info: LogInfo = { version: APP_VERSION, platform };
  const p = parseUserAgent(ua);
  if (p.android) info.android = p.android;
  if (p.model) info.model = p.model;
  if (p.webview) info.webview = p.webview;
  return info;
}

// ---- formatting ----

function two(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function logDate(t: number): string {
  const d = new Date(t);
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}

export function logTime(t: number): string {
  const d = new Date(t);
  return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
}

function infoLines(info: LogInfo): string[] {
  const lines = ['OMP: ' + info.version, 'Платформа: ' + info.platform];
  if (info.android) lines.push('Android: ' + info.android);
  if (info.model) lines.push('Модель: ' + info.model);
  if (info.webview) lines.push('WebView: ' + info.webview);
  return lines;
}

function entryLine(e: LogEntry): string {
  return logDate(e.t) + ' ' + logTime(e.t) + ' ' + LEVEL_LABEL[e.l] + ' ' + AREA_LABEL[e.a] + ': ' + e.x;
}

/** Plain text of the whole log (oldest first) with a header. */
export function formatLog(info: LogInfo, list?: LogEntry[]): string {
  const src = list || entries;
  return infoLines(info).concat(['Записей: ' + src.length, '']).concat(src.map(entryLine)).join('\n') + '\n';
}

// ---- GitHub report ----

export const ISSUE_URL = 'https://github.com/spacesarmat/omp/issues/new';
export const ISSUE_URL_MAX = 6000;
export const ISSUE_LINES = 30;
export const LOG_COPIED_NOTE = 'Журнал скопирован — вставьте его сюда.';
export const LOG_NOT_COPIED_NOTE = 'Не удалось скопировать журнал — приложите файл через «Поделиться журналом».';

/** New-issue URL: title, body with the device and the last error lines when they fit (else a note). */
export function githubIssueUrl(info: LogInfo, copied = true, list?: LogEntry[]): string {
  const src = list || entries;
  const errors = src.filter((e) => e.l === 'error').slice(-ISSUE_LINES);
  const head = infoLines(info).map((l) => '- ' + l).join('\n') + '\n\n**Что случилось:**\n(опишите, что вы делали и что пошло не так)\n';
  const prefix = ISSUE_URL + '?title=' + encodeURIComponent('Ошибка в OMP ' + info.version) + '&body=';
  for (let n = errors.length; n >= 0; n--) {
    let body = head;
    if (n > 0) body += '\n**Последние ошибки:**\n```\n' + errors.slice(errors.length - n).map(entryLine).join('\n') + '\n```\n';
    if (n < errors.length || n === 0) body += '\n' + (copied ? LOG_COPIED_NOTE : LOG_NOT_COPIED_NOTE) + '\n';
    const url = prefix + encodeURIComponent(body);
    if (url.length <= ISSUE_URL_MAX || n === 0) return url;
  }
  return prefix;
}

// ---- hooks ----

/** File name, no directories or query. */
export function baseName(path: string): string {
  const p = String(path || '').split(/[?#]/)[0];
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return p.slice(i + 1);
}

let hooked = false;

/** window error / unhandledrejection -> log (message and source file name only); once per page. */
export function installErrorHooks(): void {
  if (hooked || typeof window === 'undefined') return;
  hooked = true;
  window.addEventListener('error', (ev: ErrorEvent) => {
    const file = ev && ev.filename ? baseName(ev.filename) : '';
    log('error', 'app', 'Ошибка: ' + (ev && ev.message ? ev.message : 'неизвестная') + (file ? ' (' + file + ')' : ''));
  });
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev ? (ev.reason as unknown) : null;
    const msg =
      reason && typeof (reason as { message?: unknown }).message === 'string'
        ? (reason as { message: string }).message
        : typeof reason === 'string'
          ? reason
          : 'без описания';
    log('error', 'app', 'Необработанная ошибка: ' + msg);
  });
  window.addEventListener('pagehide', flushLog);
}

/** First log line of a run. */
export function logStart(platform: string): void {
  const i = currentLogInfo(platform);
  log('info', 'app', 'Запуск OMP ' + i.version + ' · ' + platform + (i.android ? ' · Android ' + i.android : '') + (i.webview ? ' · WebView ' + i.webview : ''));
}

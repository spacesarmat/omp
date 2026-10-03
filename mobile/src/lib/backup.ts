// Settings backup (phone): collect → file → validate → apply. Pure: only localStorage and the sanitizers of the
// stores themselves. Format v1: { format: 'omp-backup', v: 1, omp, at, data: { <tsp.* key>: value } }.
// Only the ALLOWLIST below is ever written to a file or restored; anything else in a file is ignored.
// Never in a copy: tracker passwords/cookies (Android encrypted storage, not localStorage), the error log
// (tsp.log) and caches/derived state (see NOT_BACKED_UP).
import { isObject } from '../../../src/store/storage';
import { sanitizeServers } from '../../../src/store/servers';
import { sanitizeSettings } from '../../../src/store/settings';
import { sanitizeFavorites } from '../../../src/store/favorites';
import { sanitizeTrackPrefs } from '../../../src/store/trackPrefs';
import { sanitizeSourcePrefs } from '../../../src/sources/store';
import { sanitizeSubs } from '../../../src/monitor/subs';
import { sanitizeMonitorSettings } from '../../../src/monitor/settings';
import { sanitizeTvs } from '../tv/tvStore';
import { sanitizeTouchpad } from '../tv/touchpad';
import { APP_VERSION } from '../../../src/version';
import { logDate } from '../../../src/lib/log';

export const BACKUP_FORMAT = 'omp-backup';
export const BACKUP_VERSION = 1;
/** Most entries of one collection; a real copy has a handful. */
export const BACKUP_MAX_ITEMS = 200;
/** A copy is a few KB; anything bigger is not ours. */
export const BACKUP_MAX_BYTES = 1024 * 1024;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  v: number;
  omp: string;
  /** ISO date of the copy. */
  at: string;
  data: { [key: string]: unknown };
}

/** Returns the cleaned value or undefined when the value is not usable (the key is then skipped). */
type Clean = (v: unknown) => unknown;

function tooMany(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > BACKUP_MAX_ITEMS;
  return isObject(v) && Object.keys(v).length > BACKUP_MAX_ITEMS;
}

/** A non-empty list that cleans down to nothing is garbage, not "the user has none". */
function cleanList(raw: unknown, cleaned: unknown[]): unknown[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  if (raw.length > 0 && cleaned.length === 0) return undefined;
  return cleaned;
}

function cleanMap(raw: unknown, cleaned: { [k: string]: unknown }): { [k: string]: unknown } | undefined {
  if (!isObject(raw)) return undefined;
  if (Object.keys(raw).length > 0 && Object.keys(cleaned).length === 0) return undefined;
  return cleaned;
}

function cleanServers(v: unknown): unknown {
  const list = sanitizeServers(v)
    .filter((s) => /^https?:\/\/\S+$/i.test(s.url))
    .map((s) => {
      const o: { id: string; name: string; url: string; user?: string; password?: string } = { id: s.id, name: s.name, url: s.url };
      if (typeof s.user === 'string' && s.user) o.user = s.user;
      if (typeof s.password === 'string' && s.password) o.password = s.password;
      return o;
    })
    .filter((s, i, a) => a.findIndex((x) => x.id === s.id || x.url === s.url) === i);
  return cleanList(v, list);
}

function cleanObject(sanitize: (v: unknown) => unknown): Clean {
  return (v) => (isObject(v) ? sanitize(v) : undefined);
}

const cleanActive: Clean = (v) => (v === null || typeof v === 'string' ? v : undefined);

export interface BackupKey {
  key: string;
  clean: Clean;
}

/** Everything a copy may contain. Order is the order in the file. */
export const BACKUP_KEYS: BackupKey[] = [
  { key: 'tsp.servers', clean: cleanServers },
  { key: 'tsp.activeServer', clean: cleanActive },
  { key: 'tsp.tvs', clean: (v) => cleanList(v, sanitizeTvs(v)) },
  { key: 'tsp.activeTv', clean: cleanActive },
  { key: 'tsp.subs', clean: (v) => cleanList(v, sanitizeSubs(v)) },
  { key: 'tsp.monitor', clean: cleanObject(sanitizeMonitorSettings) },
  { key: 'tsp.sources', clean: (v) => cleanMap(v, sanitizeSourcePrefs(v)) },
  { key: 'tsp.settings', clean: cleanObject(sanitizeSettings) },
  { key: 'tsp.touchpad', clean: cleanObject(sanitizeTouchpad) },
  { key: 'tsp.localServer', clean: (v) => (isObject(v) && typeof v.autostart === 'boolean' ? { autostart: v.autostart } : undefined) },
  { key: 'tsp.playlists', clean: (v) => cleanList(v, sanitizeFavorites(v)) },
  { key: 'tsp.trackPrefs', clean: (v) => cleanMap(v, sanitizeTrackPrefs(v)) },
];

/** Known keys that a copy deliberately leaves out (documentation + tested: none of them is in BACKUP_KEYS). */
export const NOT_BACKED_UP: string[] = [
  'tsp.log', // error log: personal, per device
  'tsp.newsFeed', // cache of the release feed
  'tsp.torrents', // cache of the server's list
  'tsp.torrentsAt',
  'tsp.posterTried',
  'tsp.progress', // viewing progress: lives on TorrServer
  'tsp.update', // update-check state
  'tsp.seenVersion', // «Что нового» was shown
  'tsp.subsSeen', // what monitoring has already seen: rebuilt on the first run
  'tsp.monitorFound',
  'tsp.monitorLast',
  'tsp.monitorEpisodeCursor',
  'tsp.monitorNotifyAsked',
  'tsp.monitorNotifyHint',
  'tsp.sourcesTransfer', // state of the last handover to the TV
  'tsp.sourcesSent',
];

function readRaw(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch (e) {
    return undefined;
  }
}

/** Keys whose sanitizer fills defaults: a partial file is merged over the current values. */
const MERGED = ["tsp.settings", "tsp.touchpad", "tsp.monitor"];

function ids(list: unknown, field: string): string[] {
  return Array.isArray(list) ? list.filter(isObject).map((x) => String((x as Record<string, unknown>)[field])) : [];
}

/** Active ids must point at something that exists afterwards: in the copy, or (when the copy brings no list) in the phone. */
function crossCheck(data: { [key: string]: unknown }, merge: boolean): void {
  const pairs: [string, string, string][] = [
    ["tsp.servers", "tsp.activeServer", "id"],
    ["tsp.tvs", "tsp.activeTv", "ip"],
  ];
  pairs.forEach((p) => {
    const hasList = p[0] in data;
    if (!hasList && !(p[1] in data)) return;
    const list = hasList ? data[p[0]] : merge ? readRaw(p[0]) : undefined;
    const known = ids(list, p[2]);
    let id = p[1] in data ? data[p[1]] : merge ? readRaw(p[1]) : null;
    if (typeof id !== "string" || known.indexOf(id) < 0) id = null;
    if (p[1] in data || (hasList && merge)) data[p[1]] = id;
  });
}

function cleanData(src: { [key: string]: unknown }, merge: boolean): { [key: string]: unknown } {
  const data: { [key: string]: unknown } = {};
  BACKUP_KEYS.forEach((k) => {
    if (!Object.prototype.hasOwnProperty.call(src, k.key)) return;
    let raw = src[k.key];
    if (tooMany(raw)) return;
    if (merge && MERGED.indexOf(k.key) >= 0 && isObject(raw)) {
      const cur = readRaw(k.key);
      raw = Object.assign({}, isObject(cur) ? cur : {}, raw);
    }
    const v = k.clean(raw);
    if (v !== undefined) data[k.key] = v;
  });
  crossCheck(data, merge);
  return data;
}

/** The copy of what is in localStorage right now (allowlist only, every value through its sanitizer). */
export function collectBackup(now: number): BackupFile {
  const src: { [key: string]: unknown } = {};
  BACKUP_KEYS.forEach((k) => {
    const v = readRaw(k.key);
    if (v !== undefined) src[k.key] = v;
  });
  return { format: BACKUP_FORMAT, v: BACKUP_VERSION, omp: APP_VERSION, at: new Date(now).toISOString(), data: cleanData(src, false) };
}

export function serializeBackup(b: BackupFile): string {
  return JSON.stringify(b, null, 2);
}

/** «omp-копия-2026-10-03.json» */
export function backupFileName(now: number): string {
  return 'omp-копия-' + logDate(now) + '.json';
}

export type ParseResult = { ok: true; backup: BackupFile } | { ok: false; error: string };

export const ERR_TOO_BIG = 'Файл слишком большой — это не копия OMP';
export const ERR_NOT_JSON = 'Это не копия OMP: файл не удалось прочитать';
export const ERR_FORMAT = 'Это не копия OMP';
export const ERR_VERSION_NEW = 'Копия сделана более новой версией OMP — обновите приложение и повторите';
export const ERR_VERSION = 'Неизвестная версия копии';
export const ERR_TOO_MANY = 'В копии слишком много записей — это не копия OMP';
export const ERR_EMPTY = 'В копии нет данных для восстановления';

/** Validates a file's text; the returned backup holds only allowlisted, sanitized keys. */
export function parseBackup(text: string): ParseResult {
  if (text.length > BACKUP_MAX_BYTES) return { ok: false, error: ERR_TOO_BIG };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: ERR_NOT_JSON };
  }
  if (!isObject(v) || v.format !== BACKUP_FORMAT || !isObject(v.data)) return { ok: false, error: ERR_FORMAT };
  if (typeof v.v !== 'number' || !Number.isInteger(v.v) || v.v < 1) return { ok: false, error: ERR_VERSION };
  if (v.v > BACKUP_VERSION) return { ok: false, error: ERR_VERSION_NEW };
  const raw = v.data as { [key: string]: unknown };
  if (BACKUP_KEYS.some((k) => Object.prototype.hasOwnProperty.call(raw, k.key) && tooMany(raw[k.key]))) {
    return { ok: false, error: ERR_TOO_MANY };
  }
  const data = cleanData(raw, true);
  if (Object.keys(data).length === 0) return { ok: false, error: ERR_EMPTY };
  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      v: v.v,
      omp: typeof v.omp === 'string' ? v.omp.slice(0, 32) : '',
      at: typeof v.at === 'string' ? v.at.slice(0, 40) : '',
      data,
    },
  };
}

/** Replaces the allowlisted keys that the copy has; the rest of localStorage stays. All or nothing: when a write
 *  fails the old values are put back and the error is rethrown. */
export function applyBackup(b: BackupFile): void {
  const data = cleanData(b.data, true);
  const keys = Object.keys(data);
  const old: { [key: string]: string | null } = {};
  keys.forEach((key) => {
    old[key] = localStorage.getItem(key);
  });
  try {
    keys.forEach((key) => {
      localStorage.setItem(key, JSON.stringify(data[key]));
    });
  } catch (e) {
    keys.forEach((key) => {
      try {
        if (old[key] === null) localStorage.removeItem(key);
        else localStorage.setItem(key, old[key] as string);
      } catch (e2) {
        // nothing more can be done for this key
      }
    });
    throw e;
  }
}

export interface BackupSummary {
  servers: string[];
  tvs: string[];
  subs: number;
  sources: number;
  playlists: number;
  tracks: number;
  /** A TorrServer password is in the file. */
  hasPassword: boolean;
  /** TV pairing keys/tokens are in the file. */
  hasPairKeys: boolean;
  settings: boolean;
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter(isObject) as Record<string, unknown>[]) : [];
}

export function summarizeBackup(b: BackupFile): BackupSummary {
  const servers = arr(b.data['tsp.servers']);
  const tvs = arr(b.data['tsp.tvs']);
  const sources = b.data['tsp.sources'];
  return {
    servers: servers.map((s) => String(s.name)),
    tvs: tvs.map((t) => String(t.name)),
    subs: arr(b.data['tsp.subs']).length,
    playlists: arr(b.data['tsp.playlists']).length,
    tracks: isObject(b.data['tsp.trackPrefs']) ? Object.keys(b.data['tsp.trackPrefs'] as object).length : 0,
    sources: isObject(sources) ? Object.keys(sources).length : 0,
    hasPassword: servers.some((s) => typeof s.password === 'string' && !!s.password),
    hasPairKeys: tvs.some((t) => !!t.clientKey || !!t.token),
    settings: ['tsp.settings', 'tsp.touchpad', 'tsp.monitor', 'tsp.localServer'].some((k) => k in b.data),
  };
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function named(n: number, names: string[]): string {
  const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '');
  return n + (shown ? ' (' + shown + ')' : '');
}

/** The lines of the confirmation screen: what the file holds. */
export function summaryLines(s: BackupSummary): string[] {
  const out: string[] = [];
  if (s.servers.length) out.push('Серверов TorrServer: ' + named(s.servers.length, s.servers));
  if (s.tvs.length) out.push('Телевизоров: ' + named(s.tvs.length, s.tvs));
  if (s.subs) out.push(s.subs + ' ' + plural(s.subs, 'подписка', 'подписки', 'подписок') + ' мониторинга');
  if (s.sources) out.push('Источники поиска: ' + s.sources + ' ' + plural(s.sources, 'переключатель', 'переключателя', 'переключателей'));
  if (s.playlists) out.push('Избранных плейлистов: ' + s.playlists);
  if (s.tracks) out.push('Выбор дорожек: ' + s.tracks + ' ' + plural(s.tracks, 'раздача', 'раздачи', 'раздач'));
  if (s.settings) out.push('Настройки приложения, мониторинга и тачпада, вид каталога');
  return out;
}

/** Shown before saving and when reviewing a file. */
export function backupWarning(s?: BackupSummary): string {
  if (s && !s.hasPassword && !s.hasPairKeys) return 'В копии есть адреса серверов — храните файл в надёжном месте.';
  return 'В копии есть адреса серверов, пароль доступа к вашему TorrServer, если он задан, и ключи пар с телевизорами — храните файл как пароль.';
}

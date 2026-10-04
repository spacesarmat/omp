// FlareSolverr in «Источники поиска»: the check («Проверить» → «Работает · версия 3.4 · ответ 0,3 с»), the LAN search on
// port 8191 (native scan of the device's /24, then an HTTP probe: GET / answers { msg: 'FlareSolverr is ready!', version })
// and the state texts of the phone screen and the Android TV block. Requests go only to the address the user set or OMP
// found on the LAN. Android only (lazy, out of the LG bundle). Chromium 53 safe.
import { isObject, loadJson, saveJson } from '../store/storage';
import { FLARE_PORT, flareSolverrUrl, normalizeFlareUrl, setFlareSolverrUrl } from './flareStore';
import type { LanScan } from './indexerDiscovery';
import type { SourceHttp } from './types';

export const READY_MSG = 'FlareSolverr is ready!';
export const SCAN_EVERY_MS = 24 * 60 * 60 * 1000;
const SCAN_KEY = 'tsp.flareScan';
const PROBE_TIMEOUT_MS = 4000;
const MAX_HITS = 16;

export const BAD_ADDRESS = 'Неверный адрес';
export const NOT_ANSWERING = 'Не отвечает — проверьте адрес и что FlareSolverr запущен';
export const NOT_FLARE = 'По этому адресу отвечает не FlareSolverr';
export const NOT_FOUND = 'FlareSolverr в домашней сети не найден';
export const NO_WIFI = 'Подключитесь к Wi-Fi, чтобы искать в домашней сети';

/** Phone screen texts (mockup «FlareSolverr»). */
export const FLARE_INTRO =
  'Программа на вашем сервере, которая проходит проверку Cloudflare. OMP обращается к ней, только если встроенная проверка не прошла.';
export const FLARE_NONE_TITLE = 'Нет FlareSolverr?';
export const FLARE_NONE_TEXT =
  'Его ставят одной командой Docker на компьютер или NAS, который всегда включён. Пошаговая инструкция — в «Вопросах и ответах».';
export const FLARE_HOWTO = 'Как установить FlareSolverr';

export type FlareCheck = { ok: true; version: string; ms: number } | { ok: false; message: string };

export interface FlareStatus {
  url: string;
  check: FlareCheck;
  at: number;
}

/** «3.4.0» → «3.4». */
export function shortVersion(v: string): string {
  const m = /^v?(\d+)\.(\d+)/.exec(v.trim());
  return m ? m[1] + '.' + m[2] : v.trim().slice(0, 20);
}

function seconds(ms: number): string {
  return (Math.round(ms / 100) / 10).toFixed(1).replace('.', ',');
}

/** «Работает · версия 3.4 · ответ 0,3 с», or the error. */
export function checkText(c: FlareCheck): string {
  if (!c.ok) return c.message;
  return 'Работает' + (c.version ? ' · версия ' + shortVersion(c.version) : '') + ' · ответ ' + seconds(c.ms) + ' с';
}

/** The answer of GET {url}/: the version when it is FlareSolverr, null when it is something else. */
export function readyVersion(text: string): string | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!isObject(o) || o.msg !== READY_MSG) return null;
  return typeof o.version === 'string' ? o.version.slice(0, 20) : '';
}

/** GET {url}/ through the native http; never rejects. */
export function checkFlareSolverr(url: string, http: SourceHttp, now: () => number = Date.now): Promise<FlareCheck> {
  const base = normalizeFlareUrl(url);
  if (!base) return Promise.resolve({ ok: false, message: BAD_ADDRESS } as FlareCheck);
  const t0 = now();
  return http.get(base + '/', { timeoutMs: PROBE_TIMEOUT_MS }).then(
    (r): FlareCheck => {
      const v = r.status >= 200 && r.status < 300 ? readyVersion(r.text) : null;
      if (v === null) return { ok: false, message: NOT_FLARE };
      return { ok: true, version: v, ms: Math.max(0, now() - t0) };
    },
    (): FlareCheck => ({ ok: false, message: NOT_ANSWERING }),
  );
}

// ---- the last check, in memory (the phone screen and the TV block show it) ----

let status: FlareStatus | null = null;
const listeners: Array<() => void> = [];

export function flareStatus(): FlareStatus | null {
  return status;
}

export function setFlareStatus(s: FlareStatus | null): void {
  status = s;
  listeners.slice().forEach((cb) => cb());
}

export function onFlareStatus(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Checks the saved address and remembers the result; null when no address is saved. */
export function refreshFlareStatus(http: SourceHttp, now: () => number = Date.now): Promise<FlareStatus | null> {
  const url = flareSolverrUrl();
  if (!url) {
    setFlareStatus(null);
    return Promise.resolve(null);
  }
  return checkFlareSolverr(url, http, now).then((check) => {
    const s: FlareStatus = { url, check, at: now() };
    // the address changed while checking: the old answer is not shown
    if (flareSolverrUrl() === url) setFlareStatus(s);
    return s;
  });
}

// ---- LAN search on 8191 ----

function isPrivateIp(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  if (!m) return false;
  const a = +m[1];
  const b = +m[2];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * FlareSolverr instances on the device's /24: the native scan of port 8191, then GET / on each hit (one at a time).
 * null: not on a home network (mobile data) or the scan failed. Saves the time of a finished scan (no addresses).
 */
export function scanFlareSolverr(scan: LanScan, http: SourceHttp, now: () => number = Date.now): Promise<string[] | null> {
  return scan([FLARE_PORT]).then(
    (hits) => {
      if (hits === null) return null;
      const urls: string[] = [];
      (Array.isArray(hits) ? hits : []).forEach((h) => {
        if (!h || typeof h.ip !== 'string' || h.port !== FLARE_PORT || !isPrivateIp(h.ip)) return;
        const u = 'http://' + h.ip + ':' + FLARE_PORT;
        if (urls.length < MAX_HITS && urls.indexOf(u) < 0) urls.push(u);
      });
      const found: string[] = [];
      const next = (i: number): Promise<string[]> => {
        if (i >= urls.length) return Promise.resolve(found);
        return checkFlareSolverr(urls[i], http, now).then((c) => {
          if (c.ok) found.push(urls[i]);
          return next(i + 1);
        });
      };
      return next(0).then((list) => {
        saveJson(SCAN_KEY, { at: now() });
        return list;
      });
    },
    () => null,
  );
}

/** The automatic search (TV, no address saved) is due: never ran, more than a day ago, or the clock went back. */
export function flareScanDue(now: number): boolean {
  const v = loadJson<unknown>(SCAN_KEY, null, (x) => x === null || isObject(x));
  const at = isObject(v) && typeof v.at === 'number' && isFinite(v.at) ? v.at : null;
  return at === null || now - at >= SCAN_EVERY_MS || now < at;
}

/**
 * The TV block on open: checks the saved address; without one, searches the LAN once a day and keeps the first
 * FlareSolverr found. Never rejects.
 */
export function tvFlareRefresh(http: SourceHttp, scan: LanScan | null, now: () => number = Date.now): Promise<FlareStatus | null> {
  if (flareSolverrUrl() || !scan || !flareScanDue(now())) return refreshFlareStatus(http, now).catch(() => null);
  return scanFlareSolverr(scan, http, now).then(
    (found) => {
      if (found && found.length && !flareSolverrUrl()) setFlareSolverrUrl(found[0]);
      return refreshFlareStatus(http, now);
    },
    () => null,
  );
}

/** «192.168.1.191:8191» of an address. */
export function flareHost(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url || '');
  return m ? m[1] : url;
}

export interface FlareLines {
  /** «192.168.1.191:8191 · версия 3.4», '' without an address. */
  where: string;
  state: string;
  tone: 'ok' | 'bad' | 'muted';
}

export const TV_FLARE_OK = 'Работает — запасной путь для сайтов за Cloudflare';
export const TV_FLARE_NONE = 'Не найден в домашней сети. Нужен, только если встроенная проверка Cloudflare не проходит.';
export const TV_FLARE_CHECKING = 'Проверяю…';

/** The Android TV block (mockup: address · version, state line). */
export function tvFlareLines(url: string | null, s: FlareStatus | null): FlareLines {
  if (!url) return { where: '', state: TV_FLARE_NONE, tone: 'muted' };
  const st = s && s.url === url ? s : null;
  if (!st) return { where: flareHost(url), state: TV_FLARE_CHECKING, tone: 'muted' };
  if (!st.check.ok) return { where: flareHost(url), state: st.check.message, tone: 'bad' };
  return {
    where: flareHost(url) + (st.check.version ? ' · версия ' + shortVersion(st.check.version) : ''),
    state: TV_FLARE_OK,
    tone: 'ok',
  };
}

/** The phone «Источники поиска» row: the address and the last check, or «не задан». */
export function phoneFlareNote(url: string | null, s: FlareStatus | null): { text: string; tone: 'ok' | 'bad' | 'muted' } {
  if (!url) return { text: 'не задан · запасной путь для сайтов за Cloudflare', tone: 'muted' };
  const st = s && s.url === url ? s : null;
  if (!st) return { text: flareHost(url), tone: 'muted' };
  return st.check.ok ? { text: flareHost(url) + ' · работает', tone: 'ok' } : { text: flareHost(url) + ' · не отвечает', tone: 'bad' };
}

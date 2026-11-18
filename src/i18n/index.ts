import { signal } from '@preact/signals';
import { ru } from './ru';
import { en } from './en';
import { uk } from './uk';
import { be } from './be';
import { kk } from './kk';
import { ky } from './ky';
import { uz } from './uz';
import { tg } from './tg';
import { tk } from './tk';
import { hy } from './hy';
import { az } from './az';
import { ka } from './ka';
import { ro } from './ro';
import type { StringKeys, PluralKeys } from './types';

export type { Plural, EnPlural, EnDict, StringKeys, PluralKeys } from './types';

export type Lang = 'ru' | 'en' | 'uk' | 'be' | 'kk' | 'ky' | 'uz' | 'tg' | 'tk' | 'hy' | 'az' | 'ka' | 'ro';
export type LanguageSetting = 'system' | Lang;
/** Supported UI languages, the same codes as the bot (botCopy LANG_CODES). */
export const LANGS: readonly Lang[] = ['ru', 'en', 'uk', 'be', 'kk', 'ky', 'uz', 'tg', 'tk', 'hy', 'az', 'ka', 'ro'];
/** Languages written in Cyrillic: native player/OS messages in that script pass through untranslated. */
export const CYRILLIC_LANGS: readonly Lang[] = ['ru', 'uk', 'be', 'kk', 'ky', 'tg'];
/** Dot path of a string in the dictionaries: 'common.signInTo'. */
export type Key = StringKeys<typeof ru>;
/** Dot path of a plural in the dictionaries: 'common.torrents'. */
export type PluralKey = PluralKeys<typeof ru>;
export type Params = { [k: string]: string | number };

/** The current UI language. t() reads it with peek(): the app roots re-mount the UI (key={lang.value}) when it changes. */
export const lang = signal<Lang>('ru');

/** Translated packs plug in here as they land; a missing pack or key falls back to Russian. */
export const DICTS: Partial<Record<Lang, unknown>> = { ru, en, uk, be, kk, ky, uz, tg, tk, hy, az, ka, ro };

/** Prefix match so regional variants (uk-UA, kk-KZ, en-US, ...) map to the base code. Unsupported stays ''. */
export function normalizeLang(code: string): Lang | '' {
  const c = String(code || '').toLowerCase();
  for (let i = 0; i < LANGS.length; i++) {
    if (c.indexOf(LANGS[i]) === 0) return LANGS[i];
  }
  return '';
}

/** 'system' → the first browser language normalized to a supported code; unsupported (or none) → English. */
export function resolveLanguage(setting: LanguageSetting, nav: string[]): Lang {
  if (setting !== 'system') return setting;
  return normalizeLang(nav[0] || '') || 'en';
}

function navLangs(): string[] {
  try {
    const n = typeof navigator !== 'undefined' ? navigator : null;
    if (!n) return [];
    if (n.languages && n.languages.length) return Array.prototype.slice.call(n.languages);
    return n.language ? [n.language] : [];
  } catch (e) {
    return [];
  }
}

/** Sets the UI language from the setting and the browser languages. */
export function applyLanguageSetting(setting: LanguageSetting): void {
  lang.value = resolveLanguage(setting, navLangs());
}

function lookup(dict: unknown, key: string): unknown {
  const parts = key.split('.');
  let cur: unknown = dict;
  for (let i = 0; i < parts.length; i++) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as { [k: string]: unknown })[parts[i]];
  }
  return cur;
}

function fill(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m));
}

function entry(key: string): unknown {
  const v = lookup(DICTS[lang.peek()] || ru, key);
  return v !== undefined ? v : lookup(ru, key);
}

/** The string for the key in the current language (Russian fallback, then the key itself), with {placeholders} filled. */
export function t(key: Key, params?: Params): string {
  const v = entry(key);
  return typeof v === 'string' ? fill(v, params) : key;
}

function ruForm(n: number): 'one' | 'few' | 'many' {
  if (n !== Math.floor(n)) return 'few';
  const m10 = Math.abs(n) % 10;
  const m100 = Math.abs(n) % 100;
  if (m10 === 1 && m100 !== 11) return 'one';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few';
  return 'many';
}

/** Romanian: one, few for 0 and 2-19, many otherwise (the same rule as the bot). */
function roForm(n: number): 'one' | 'few' | 'many' {
  const a = Math.abs(Math.floor(n));
  if (a === 1) return 'one';
  const d100 = a % 100;
  return a === 0 || (d100 >= 2 && d100 <= 19) ? 'few' : 'many';
}

/** The plural form for n in the current language, {n} filled with the number. */
export function tp(key: PluralKey, n: number, params?: Params): string {
  const v = entry(key);
  if (!v || typeof v !== 'object') return key;
  const forms = v as { [k: string]: string };
  const form = 'other' in forms ? (n === 1 ? 'one' : 'other') : lang.peek() === 'ro' ? roForm(n) : ruForm(n);
  const s = forms[form];
  if (typeof s !== 'string') return key;
  const all: Params = {};
  if (params) for (const k in params) all[k] = params[k];
  all.n = n === Math.floor(n) ? String(n) : fmtNumber(n);
  return fill(s, all);
}

/** «7,4» in most languages, «7.4» in English; digits = fixed decimals. */
export function fmtNumber(n: number, digits?: number): string {
  const s = digits === undefined ? String(n) : n.toFixed(digits);
  return lang.peek() === 'en' ? s : s.replace('.', ',');
}

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** «8,2 ГБ» / «8.2 GB»; under 1 GiB in whole megabytes: «700 МБ» / «700 MB». */
export function fmtSize(bytes: number): string {
  if (bytes < GIB) return fmtNumber(bytes / MIB, 0) + ' ' + t('common.mb');
  return fmtNumber(bytes / GIB, 1) + ' ' + t('common.gb');
}

/** "0 B", "512 KB", "1.4 GB" in the UI language's units and decimal mark: binary steps, one decimal under 100. */
export function fmtBytes(n: number): string {
  const units = t('common.units').split(' ');
  if (!isFinite(n) || n <= 0) return '0 ' + units[0];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (i === 0 ? String(Math.round(v)) : fmtNumber(v, v >= 100 ? 0 : 1)) + ' ' + units[i];
}

/** A speed: "1.2 MB/s" in the UI language. */
export function fmtSpeed(bytesPerSec: number): string {
  return t('common.perSec', { v: fmtBytes(bytesPerSec) });
}

/** «1 ч 58 мин», «2 ч», «58 мин» / «1 h 58 min». */
export function fmtDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return m + ' ' + t('common.min');
  return h + ' ' + t('common.hour') + (m ? ' ' + m + ' ' + t('common.min') : '');
}

function pad(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** 'day': «5 окт.» / «Oct 5»; 'dayTime': «5 окт. 14:20» / «Oct 5, 14:20» (local time). */
export function fmtDate(ms: number, style: 'day' | 'dayTime'): string {
  const d = new Date(ms);
  const month = t('date.months').split(' ')[d.getMonth()];
  const day = t('date.day', { d: d.getDate(), month: month });
  if (style === 'day') return day;
  return t('date.dayTime', { day: day, time: pad(d.getHours()) + ':' + pad(d.getMinutes()) });
}

/** The one short day label: «5 окт.» / «Oct 5», with the year when it is not the year of `now` («9 янв. 2025»). */
export function fmtDay(ms: number, now: number = Date.now()): string {
  const y = new Date(ms).getFullYear();
  const day = fmtDate(ms, 'day');
  return y === new Date(now).getFullYear() ? day : t('date.dayYear', { day: day, year: y });
}

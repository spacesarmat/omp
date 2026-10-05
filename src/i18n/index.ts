import { signal } from '@preact/signals';
import { ru } from './ru';
import { en } from './en';
import type { StringKeys, PluralKeys } from './types';

export type { Plural, EnPlural, EnDict, StringKeys, PluralKeys } from './types';

export type Lang = 'ru' | 'en';
export type LanguageSetting = 'system' | 'ru' | 'en';
/** Dot path of a string in the dictionaries: 'common.signInTo'. */
export type Key = StringKeys<typeof ru>;
/** Dot path of a plural in the dictionaries: 'common.torrents'. */
export type PluralKey = PluralKeys<typeof ru>;
export type Params = { [k: string]: string | number };

/** The current UI language; components re-render when it changes. */
export const lang = signal<Lang>('ru');

/** System languages that get the Russian UI. */
const RUSSIAN_SYSTEM = ['ru', 'uk', 'be', 'kk'];

/** 'system' → the first browser language: ru/uk/be/kk (any region) → Russian, anything else (or none) → English. */
export function resolveLanguage(setting: LanguageSetting, nav: string[]): Lang {
  if (setting === 'ru' || setting === 'en') return setting;
  const first = (nav[0] || '').toLowerCase().split(/[-_]/)[0];
  return RUSSIAN_SYSTEM.indexOf(first) >= 0 ? 'ru' : 'en';
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
  const v = lang.value === 'en' ? lookup(en, key) : undefined;
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

/** The plural form for n in the current language, {n} filled with the number. */
export function tp(key: PluralKey, n: number, params?: Params): string {
  const v = entry(key);
  if (!v || typeof v !== 'object') return key;
  const forms = v as { [k: string]: string };
  const form = 'other' in forms ? (n === 1 ? 'one' : 'other') : ruForm(n);
  const s = forms[form];
  if (typeof s !== 'string') return key;
  const all: Params = {};
  if (params) for (const k in params) all[k] = params[k];
  all.n = n === Math.floor(n) ? String(n) : fmtNumber(n);
  return fill(s, all);
}

/** «7,4» in Russian, «7.4» in English; digits = fixed decimals. */
export function fmtNumber(n: number, digits?: number): string {
  const s = digits === undefined ? String(n) : n.toFixed(digits);
  return lang.value === 'ru' ? s.replace('.', ',') : s;
}

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** «8,2 ГБ» / «8.2 GB»; under 1 GiB in whole megabytes: «700 МБ» / «700 MB». */
export function fmtSize(bytes: number): string {
  if (bytes < GIB) return fmtNumber(bytes / MIB, 0) + ' ' + t('common.mb');
  return fmtNumber(bytes / GIB, 1) + ' ' + t('common.gb');
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

import { lang, t } from '../i18n';
import { FAQ_RU } from './faq.ru';
import { FAQ_EN } from './faq.en';

export { OLD_Q_LINKS } from './faq.ru';
import { OLD_Q_LINKS } from './faq.ru';

/** An answer line; an object makes the whole line an external link. */
export type FaqLine = string | { text: string; url: string };

export type Device = 'lg' | 'atv' | 'phone' | 'server' | 'common';
export type SectionId = 'install' | 'connect' | 'player' | 'trouble' | 'setup' | 'about' | 'log' | 'news';

/** The FlareSolverr question (opened from Settings → Search sources → FlareSolverr). */
export const FLARESOLVERR_Q = 'flaresolverr';

/** Device chips; the label follows the UI language. */
export const DEVICES: { id: Device; readonly label: string }[] = [
  { id: 'lg', get label() { return t('faq.dev.lg'); } },
  { id: 'atv', get label() { return t('faq.dev.atv'); } },
  { id: 'phone', get label() { return t('faq.dev.phone'); } },
  { id: 'server', get label() { return t('faq.dev.server'); } },
  { id: 'common', get label() { return t('faq.dev.common'); } },
];

/** Section order on the screen; a device skips the sections it has no items in. */
export const SECTIONS: { id: SectionId; readonly label: string }[] = [
  { id: 'install', get label() { return t('faq.sec.install'); } },
  { id: 'connect', get label() { return t('faq.sec.connect'); } },
  { id: 'player', get label() { return t('faq.sec.player'); } },
  { id: 'trouble', get label() { return t('faq.sec.trouble'); } },
  { id: 'setup', get label() { return t('faq.sec.setup'); } },
  { id: 'about', get label() { return t('faq.sec.about'); } },
  { id: 'log', get label() { return t('faq.sec.log'); } },
  { id: 'news', get label() { return t('faq.sec.news'); } },
];

/** Per-device text override of an item that is shown under several devices. */
export interface FaqOverride {
  q?: string;
  short?: FaqLine[];
  more?: FaqLine[];
}

/** The texts of one item in one language (faq.ru.ts / faq.en.ts). */
export interface FaqText {
  /** Short question. */
  q: string;
  /** 2-5 short lines or numbered steps. */
  short: FaqLine[];
  /** The longer explanation behind «More». */
  more?: FaqLine[];
  by?: { [d in Device]?: FaqOverride };
}

export interface FaqItem {
  id: string;
  section: SectionId;
  /** Devices that list the item; the first one is the primary (used by deep links). */
  devices: Device[];
  /** The texts below follow the current UI language. */
  readonly q: string;
  readonly short: FaqLine[];
  readonly more: FaqLine[] | undefined;
  readonly by: FaqText['by'];
}

export interface FaqView {
  q: string;
  short: FaqLine[];
  more: FaqLine[];
}

/** The texts of an item in the current language (Russian when the item is missing in English). */
export function faqText(id: string): FaqText {
  const en = lang.peek() === 'en' ? FAQ_EN[id] : undefined;
  return en || FAQ_RU[id];
}

/** The text of an item as shown under `device`. */
export function itemFor(it: FaqItem, device: Device): FaqView {
  const x = faqText(it.id);
  const o = x.by && x.by[device];
  return {
    q: o && o.q !== undefined ? o.q : x.q,
    short: o && o.short !== undefined ? o.short : x.short,
    more: o && o.more !== undefined ? o.more : x.more !== undefined ? x.more : [],
  };
}

interface FaqStruct {
  id: string;
  section: SectionId;
  devices: Device[];
}

const STRUCT: FaqStruct[] = [
  { id: 'lg-version', section: 'install', devices: ['lg'] },
  { id: 'lg-root', section: 'install', devices: ['lg'] },
  { id: 'lg-devmode', section: 'install', devices: ['lg'] },
  { id: 'lg-hbc', section: 'install', devices: ['lg'] },
  { id: 'lg-devmode-expiry', section: 'install', devices: ['lg'] },
  { id: 'lg-update', section: 'install', devices: ['lg'] },
  { id: 'atv-install', section: 'install', devices: ['atv'] },
  { id: 'atv-adb', section: 'install', devices: ['atv'] },
  { id: 'atv-boxes', section: 'install', devices: ['atv', 'server'] },
  { id: 'apk-choice', section: 'install', devices: ['phone', 'atv'] },
  { id: 'xiaomi', section: 'install', devices: ['atv'] },
  { id: 'sber', section: 'install', devices: ['atv'] },
  { id: 'yandex', section: 'install', devices: ['atv'] },
  { id: 'atv-update', section: 'install', devices: ['atv'] },
  { id: 'beta', section: 'install', devices: ['phone', 'atv', 'lg'] },
  { id: 'phone-install', section: 'install', devices: ['phone'] },
  { id: 'after-install', section: 'install', devices: ['phone', 'lg', 'atv'] },
  { id: 'samsung', section: 'install', devices: ['common', 'lg'] },
  { id: 'apk-fail', section: 'trouble', devices: ['phone', 'atv'] },
  { id: 'lg-gone', section: 'trouble', devices: ['lg'] },
  { id: 'devmgr', section: 'trouble', devices: ['lg'] },
  { id: 'helper', section: 'install', devices: ['phone', 'lg', 'atv'] },
  { id: 'safety', section: 'install', devices: ['lg', 'atv', 'phone'] },
  { id: 'lg-connect', section: 'connect', devices: ['lg', 'phone'] },
  { id: 'atv-connect', section: 'connect', devices: ['atv', 'phone'] },
  { id: 'xiaomi-connect', section: 'connect', devices: ['atv'] },
  { id: 'tv-no-server', section: 'connect', devices: ['atv', 'lg'] },
  { id: 'wake', section: 'connect', devices: ['lg', 'phone'] },
  { id: 'skip', section: 'player', devices: ['lg', 'atv', 'phone'] },
  { id: 'sound-subs', section: 'player', devices: ['phone', 'lg', 'atv'] },
  { id: 'control', section: 'player', devices: ['phone', 'lg', 'atv'] },
  { id: 'player-engine', section: 'player', devices: ['atv'] },
  { id: 'player-auto', section: 'player', devices: ['atv'] },
  { id: 'player-audio', section: 'player', devices: ['atv'] },
  { id: 'no-server', section: 'trouble', devices: ['lg', 'atv', 'phone', 'server'] },
  { id: 'no-sound', section: 'trouble', devices: ['lg', 'atv', 'phone'] },
  { id: 'notifications', section: 'trouble', devices: ['phone'] },
  { id: 'torrent-by-code', section: 'trouble', devices: ['phone'] },
  { id: 'phone-no-control', section: 'trouble', devices: ['phone', 'lg', 'atv'] },
  { id: 'sources', section: 'setup', devices: ['phone', 'atv', 'server'] },
  { id: 'sources-transfer', section: 'setup', devices: ['phone', 'atv'] },
  { id: 'jackett', section: 'setup', devices: ['phone', 'atv', 'server', 'lg'] },
  { id: 'flaresolverr', section: 'setup', devices: ['server', 'phone', 'atv'] },
  { id: 'cloudflare', section: 'setup', devices: ['phone', 'atv'] },
  { id: 'sites-login', section: 'setup', devices: ['phone', 'atv'] },
  { id: 'accounts', section: 'setup', devices: ['phone', 'atv'] },
  { id: 'discover', section: 'setup', devices: ['phone'] },
  { id: 'add-magnet', section: 'setup', devices: ['phone'] },
  { id: 'search-filters', section: 'setup', devices: ['phone'] },
  { id: 'tmdb-key', section: 'setup', devices: ['phone', 'atv', 'lg'] },
  { id: 'names', section: 'setup', devices: ['phone', 'atv', 'lg'] },
  { id: 'torrserver', section: 'install', devices: ['server', 'common'] },
  { id: 'ts-phone', section: 'install', devices: ['server', 'phone'] },
  { id: 'ts-settings', section: 'setup', devices: ['server', 'phone'] },
  { id: 'ts-covers', section: 'setup', devices: ['server', 'phone'] },
  { id: 'subscriptions', section: 'news', devices: ['common', 'phone'] },
  { id: 'new-episodes', section: 'news', devices: ['common', 'phone'] },
  { id: 'better-quality', section: 'news', devices: ['common', 'phone'] },
  { id: 'find-better', section: 'news', devices: ['phone'] },
  { id: 'series-card', section: 'setup', devices: ['phone'] },
  { id: 'log', section: 'log', devices: ['common', 'phone'] },
  { id: 'report-bug', section: 'log', devices: ['common', 'phone'] },
  { id: 'backup', section: 'log', devices: ['common', 'phone'] },
  { id: 'support', section: 'about', devices: ['common', 'phone'] },
  { id: 'telegram', section: 'about', devices: ['common', 'phone', 'atv', 'lg'] },
];

export const FAQ: FaqItem[] = STRUCT.map((s) => ({
  id: s.id,
  section: s.section,
  devices: s.devices,
  get q() { return faqText(s.id).q; },
  get short() { return faqText(s.id).short; },
  get more() { return faqText(s.id).more; },
  get by() { return faqText(s.id).by; },
}));

/** Resolves a route `q` (an item id, or an old question text) to an item and the device view to open. */
export function resolveFaqLink(q: string | undefined): { id: string; device: Device } | null {
  if (!q) return null;
  const old = OLD_Q_LINKS[q];
  const id = old ? old.id : q;
  const it = FAQ.find((x) => x.id === id);
  if (!it) return null;
  const device = old && it.devices.includes(old.device) ? old.device : it.devices[0];
  return { id, device };
}

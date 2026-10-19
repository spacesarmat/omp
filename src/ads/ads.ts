// Ads in the catalog: our own banners from the billing admin (ops/billing/src/ads.mjs). The config comes from
// GET /v1/ads-config, is kept in localStorage and refreshed every 5 minutes while a catalog screen is open. Without a
// fresh enough answer (the server is down, the app is offline for an hour) there are no ads: the safe mode is «off».
// Shared by the phone and (later) the TV bundles: Chromium 53 rules (no Error subclasses, no AbortController).
import { BILLING_ORIGIN } from '../billing/config';
import { isObject, loadJson, saveJson } from '../store/storage';

export type AdSection = 'mine' | 'discoverGrid' | 'discoverRails';
export type AdPlatform = 'phone' | 'androidTv' | 'webos';

export interface AdBanner {
  id: string;
  title: string;
  text: string;
  advertiser: string;
  erid: string;
  /** The advertiser's page (the server adds the erid to it). */
  url: string;
  /** Absolute image URL. */
  image: string;
  weight: number;
  from: number | null;
  to: number | null;
  platforms: AdPlatform[];
  sections: AdSection[];
  tvMode: 'qr' | 'noclick';
}

export interface AdsConfig {
  enabled: boolean;
  provider: string;
  everyN: number;
  firstAfter: number;
  afterInstallDays: number;
  maxPerScreen: number;
  railsEvery: number;
  sections: { [K in AdSection]: boolean };
  platforms: { [K in AdPlatform]: boolean };
  hideForSubscribers: boolean;
  tvHideIfLinkedSubscriber: boolean;
  minAppVersion: string;
  banners: AdBanner[];
  ttlSec: number;
}

export const ADS_KEY = 'tsp.adsConfig';
/** Refresh after this long (the server's cache time). */
export const ADS_TTL_MS = 5 * 60 * 1000;
/** While ads are off, asking again every 30 minutes is enough (turning them on is not urgent; turning them off is). */
export const ADS_OFF_TTL_MS = 30 * 60 * 1000;
/** A cached answer older than this is not used: no ads until the server answers again. */
export const ADS_MAX_AGE_MS = 60 * 60 * 1000;

const SECTIONS: AdSection[] = ['mine', 'discoverGrid', 'discoverRails'];
const PLATFORMS: AdPlatform[] = ['phone', 'androidTv', 'webos'];

export const ADS_OFF: AdsConfig = {
  enabled: false,
  provider: 'house',
  everyN: 10,
  firstAfter: 10,
  afterInstallDays: 3,
  maxPerScreen: 1,
  railsEvery: 3,
  sections: { mine: false, discoverGrid: false, discoverRails: false },
  platforms: { phone: false, androidTv: false, webos: false },
  hideForSubscribers: true,
  tvHideIfLinkedSubscriber: true,
  minAppVersion: '',
  banners: [],
  ttlSec: 300,
};

let imageOrigin = BILLING_ORIGIN;
/** Tests and the dev harness: where banner images come from. */
export function setAdsImageOrigin(origin?: string): void {
  imageOrigin = origin || BILLING_ORIGIN;
}

const int = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Math.floor(v) === v && v >= lo && v <= hi ? v : d;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const time = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

function flags<K extends string>(v: unknown, keys: K[]): { [P in K]: boolean } {
  const out = {} as { [P in K]: boolean };
  const src = isObject(v) ? v : {};
  for (let i = 0; i < keys.length; i++) out[keys[i]] = src[keys[i]] === true;
  return out;
}

function names<K extends string>(v: unknown, keys: K[]): K[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is K => keys.indexOf(x as K) >= 0);
}

function banner(v: unknown): AdBanner | null {
  if (!isObject(v)) return null;
  const id = str(v.id, 32);
  const url = str(v.url, 600);
  const image = str(v.image, 200);
  const erid = str(v.erid, 64);
  const advertiser = str(v.advertiser, 80);
  const title = str(v.title, 56);
  // the marking is required: a banner without the erid or the advertiser is never shown
  if (!/^[0-9a-z]{6,32}$/.test(id) || !erid || !advertiser || !title) return null;
  if (!/^https?:\/\//i.test(url) || image.indexOf('/v1/ads/img/') !== 0) return null;
  return {
    id,
    title,
    text: str(v.text, 140),
    advertiser,
    erid,
    url,
    image: imageOrigin + image,
    weight: int(v.weight, 1, 100, 1),
    from: time(v.from),
    to: time(v.to),
    platforms: names(v.platforms, PLATFORMS),
    sections: names(v.sections, SECTIONS),
    tvMode: v.tvMode === 'noclick' ? 'noclick' : 'qr',
  };
}

/** The server's answer as a config; anything unexpected is «off». */
export function sanitizeAdsConfig(v: unknown): AdsConfig {
  if (!isObject(v) || v.v !== 1 || v.enabled !== true) return ADS_OFF;
  const banners: AdBanner[] = [];
  const list = Array.isArray(v.banners) ? v.banners : [];
  for (let i = 0; i < list.length && banners.length < 50; i++) {
    const b = banner(list[i]);
    if (b) banners.push(b);
  }
  return {
    enabled: banners.length > 0,
    provider: str(v.provider, 20) || 'house',
    everyN: int(v.everyN, 6, 30, 10),
    firstAfter: int(v.firstAfter, 1, 60, 10),
    afterInstallDays: int(v.afterInstallDays, 0, 60, 3),
    maxPerScreen: int(v.maxPerScreen, 1, 2, 1),
    railsEvery: int(v.railsEvery, 2, 10, 3),
    sections: flags(v.sections, SECTIONS),
    platforms: flags(v.platforms, PLATFORMS),
    hideForSubscribers: v.hideForSubscribers !== false,
    tvHideIfLinkedSubscriber: v.tvHideIfLinkedSubscriber !== false,
    minAppVersion: str(v.minAppVersion, 20),
    banners,
    ttlSec: int(v.ttlSec, 30, 3600, 300),
  };
}

interface Cached {
  at: number;
  config: unknown;
}

const isCached = (v: unknown): boolean => isObject(v) && typeof v.at === 'number' && 'config' in v;

/** The cached config when it is fresh enough (ADS_MAX_AGE_MS), else «off». */
export function cachedAdsConfig(now: number = Date.now()): AdsConfig {
  const c = loadJson<Cached | null>(ADS_KEY, null, (v) => v === null || isCached(v));
  if (!c || now - c.at > ADS_MAX_AGE_MS || c.at > now + 60000) return ADS_OFF;
  return sanitizeAdsConfig(c.config);
}

/** Whether the cache is due for a refresh: after 5 minutes while ads are on, after 30 while they are off. */
export function adsConfigStale(now: number = Date.now()): boolean {
  const c = loadJson<Cached | null>(ADS_KEY, null, (v) => v === null || isCached(v));
  if (!c || c.at > now + 60000) return true;
  return now - c.at >= (sanitizeAdsConfig(c.config).enabled ? ADS_TTL_MS : ADS_OFF_TTL_MS);
}

export function saveAdsConfig(config: unknown, now: number = Date.now()): void {
  saveJson(ADS_KEY, { at: now, config });
}

/** «0.20.5-beta.2» ≥ «0.20.5»? Numeric parts only; a pre-release counts as its version. Empty minimum: yes. */
export function versionAtLeast(version: string, min: string): boolean {
  if (!min) return true;
  const a = (version.split('-')[0] || '').split('.');
  const b = min.split('.');
  for (let i = 0; i < 3; i++) {
    const x = parseInt(a[i] || '0', 10) || 0;
    const y = parseInt(b[i] || '0', 10) || 0;
    if (x !== y) return x > y;
  }
  return true;
}

export interface AdContext {
  platform: AdPlatform;
  section: AdSection;
  appVersion: string;
  /** The OMP subscription is on (grace included). */
  subscribed: boolean;
  /** First run of this install (ms). */
  firstRun: number;
  now: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function bannerLive(b: AdBanner, ctx: AdContext): boolean {
  if (b.platforms.indexOf(ctx.platform) < 0 || b.sections.indexOf(ctx.section) < 0) return false;
  if (b.from !== null && ctx.now < b.from) return false;
  if (b.to !== null && ctx.now > b.to) return false;
  return true;
}

/** The banners this screen may show; [] when ads are off for it (switch, section, platform, version, subscriber, install age). */
export function adsFor(cfg: AdsConfig, ctx: AdContext): AdBanner[] {
  if (!cfg.enabled || cfg.provider !== 'house') return [];
  if (!cfg.sections[ctx.section] || !cfg.platforms[ctx.platform]) return [];
  if (!versionAtLeast(ctx.appVersion, cfg.minAppVersion)) return [];
  if (cfg.hideForSubscribers && ctx.subscribed) return [];
  if (ctx.now - ctx.firstRun < cfg.afterInstallDays * DAY_MS) return [];
  return cfg.banners.filter((b) => bannerLive(b, ctx));
}

/**
 * Where the ads go in a list of `count` cards: indexes i (the ad is drawn before card i, after i cards). The first
 * after `firstAfter` cards, then every `everyN`, spaced so that one screen (`perScreen` cards) has at most
 * `maxPerScreen` of them. Never after the last card.
 */
export function adPositions(count: number, cfg: Pick<AdsConfig, 'everyN' | 'firstAfter' | 'maxPerScreen'>, perScreen: number): number[] {
  const gap = Math.max(cfg.everyN, Math.ceil(Math.max(1, perScreen) / Math.max(1, cfg.maxPerScreen)));
  const out: number[] = [];
  for (let p = Math.max(1, cfg.firstAfter); p < count; p += gap) out.push(p);
  return out;
}

/** «Обзор» home: an ad block after these rail indexes (the first after the second rail, then every `railsEvery`). */
export function railPositions(rails: number, railsEvery: number): number[] {
  const out: number[] = [];
  for (let p = 2; p < rails; p += Math.max(2, railsEvery)) out.push(p);
  return out;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** A banner for one slot by weight, the same for the slot all day (no flicker on re-render). */
export function pickBanner(banners: AdBanner[], slotKey: string, now: number): AdBanner | null {
  if (!banners.length) return null;
  let total = 0;
  for (let i = 0; i < banners.length; i++) total += banners[i].weight;
  let r = hash(slotKey + '|' + Math.floor(now / DAY_MS)) % total;
  for (let i = 0; i < banners.length; i++) {
    r -= banners[i].weight;
    if (r < 0) return banners[i];
  }
  return banners[banners.length - 1];
}

/** Interleaves the ads with the cards: { ad: index } entries before the cards at `admitted` positions. */
export function withAds<T>(items: T[], admitted: number[]): ({ item: T; ad?: undefined } | { ad: number; item?: undefined })[] {
  const out: ({ item: T; ad?: undefined } | { ad: number; item?: undefined })[] = [];
  for (let i = 0; i < items.length; i++) {
    if (admitted.indexOf(i) >= 0) out.push({ ad: i });
    out.push({ item: items[i] });
  }
  return out;
}

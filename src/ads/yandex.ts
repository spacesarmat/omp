// Yandex Mobile Ads on the phone (Android and iOS). The billing admin stores the switch, the unit ids and two
// groups. A missing or broken answer is off: already released apps ignore the field, and a new app shows nothing
// new until an admin turns the switch on. Empty unit ids mean Yandex's official demo placement.

export interface YandexGroup {
  enabled: boolean;
  /** An ad after every N cards. The first one is also after N cards. */
  everyN: number;
  afterInstallDays: number;
  /** 0: no cap. */
  maxPerSession: number;
  /** 0: no cap. Counted in Moscow calendar days. */
  maxPerDay: number;
}

export interface YandexAds {
  enabled: boolean;
  /** When Yandex has no ad, the card may show one of our banners. */
  fallbackHouse: boolean;
  androidUnit: string;
  iosUnit: string;
  groups: { free: YandexGroup; sub: YandexGroup };
}

export const YANDEX_DEMO_UNIT = 'demo-native-content-yandex';

const UNIT_RE = /^(?:R-M-[0-9A-Za-z-]{1,40}|demo-native-content-yandex|demo-native-app-yandex)$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const CAP_KEY = 'tsp.yandexCaps';

export function yandexGroupDefaults(enabled: boolean): YandexGroup {
  return { enabled, everyN: 10, afterInstallDays: 3, maxPerSession: 0, maxPerDay: 0 };
}

export const YANDEX_OFF: YandexAds = {
  enabled: false,
  fallbackHouse: true,
  androidUnit: '',
  iosUnit: '',
  groups: { free: yandexGroupDefaults(true), sub: yandexGroupDefaults(false) },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function bool(v: unknown, d: boolean): boolean {
  if (v === true || v === 'true' || v === '1' || v === 1 || v === 'on' || v === 'yes') return true;
  if (v === false || v === 'false' || v === '0' || v === 0 || v === 'off' || v === 'no' || v === '') return false;
  return d;
}

function intIn(v: unknown, lo: number, hi: number, d: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= lo && n <= hi ? n : d;
}

function unit(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return UNIT_RE.test(s) ? s : '';
}

function group(v: unknown, d: YandexGroup): YandexGroup {
  const src = isObj(v) ? v : {};
  return {
    enabled: bool(src.enabled, d.enabled),
    everyN: intIn(src.everyN, 6, 30, d.everyN),
    afterInstallDays: intIn(src.afterInstallDays, 0, 60, d.afterInstallDays),
    maxPerSession: intIn(src.maxPerSession, 0, 100, d.maxPerSession),
    maxPerDay: intIn(src.maxPerDay, 0, 500, d.maxPerDay),
  };
}

/** The server's `yandexAds` object, or the safe defaults. */
export function sanitizeYandexAds(v: unknown): YandexAds {
  if (!isObj(v)) return YANDEX_OFF;
  const groups = isObj(v.groups) ? v.groups : {};
  return {
    enabled: bool(v.enabled, false),
    fallbackHouse: bool(v.fallbackHouse, true),
    androidUnit: unit(v.androidUnit),
    iosUnit: unit(v.iosUnit),
    groups: {
      free: group(groups.free, YANDEX_OFF.groups.free),
      sub: group(groups.sub, YANDEX_OFF.groups.sub),
    },
  };
}

/** The group that may see Yandex on the phone, or null when that audience is off. */
export function groupFor(cfg: YandexAds, subscribed: boolean): YandexGroup | null {
  if (!cfg.enabled) return null;
  const g = subscribed ? cfg.groups.sub : cfg.groups.free;
  return g.enabled ? g : null;
}

/**
 * A TV linked to a phone with a subscription. `legacy`: the old hide flag. `hide`: the subscription group is off.
 * `show`: own banners at the subscription group's frequency (no Yandex SDK on TV).
 */
export function tvLinkedMode(cfg: YandexAds, linkedSubscriber: boolean): 'legacy' | 'hide' | 'show' {
  if (!linkedSubscriber || !cfg.enabled) return 'legacy';
  return cfg.groups.sub.enabled ? 'show' : 'hide';
}

export function installReady(group: YandexGroup, firstRun: number, now: number): boolean {
  return now - firstRun >= group.afterInstallDays * DAY_MS;
}

/** First slot after N cards, then every N. `maxPerScreen` still widens the gap the way own banners do. */
export function groupPlacement(group: YandexGroup): { everyN: number; firstAfter: number } {
  return { everyN: group.everyN, firstAfter: group.everyN };
}

/**
 * Native slot id. Short on purpose: Android keeps 80 characters and a discover filter key is longer than that.
 * The same id is used for load, place and hide.
 */
/** A position is worth a request when its card is within one screen above and two screens below. */
export function yandexShouldLoad(rect: { top: number; bottom: number } | null, viewport: number): boolean {
  if (!rect) return false;
  const h = viewport > 0 ? viewport : 800;
  if (rect.bottom < -h) return false;
  if (rect.top > h * 3) return false;
  return true;
}

export function yandexSlotId(pos: number, gen: number): string {
  const p = pos < 0 ? 0 : Math.floor(pos);
  const g = gen < 0 ? 0 : Math.floor(gen);
  return 'y' + g.toString(36) + 'p' + p.toString(36);
}

/** Configured unit, or the official demo placement when the admin has not pasted one. */
export function yandexUnit(cfg: YandexAds, os: 'android' | 'ios'): string {
  const raw = os === 'ios' ? cfg.iosUnit : cfg.androidUnit;
  return UNIT_RE.test(raw) ? raw : YANDEX_DEMO_UNIT;
}

export type SlotFill = 'yandex' | 'house' | 'none';

/** Yandex when it loaded, the own banner when fallback is allowed, otherwise the card stays content. */
export function slotFill(o: { yandexReady: boolean; yandexFailed: boolean; house: boolean; fallback: boolean }): SlotFill {
  if (o.yandexReady) return 'yandex';
  if (o.yandexFailed && o.fallback && o.house) return 'house';
  return 'none';
}

/** Moscow calendar day, same offset the billing admin uses for ad stats. */
export function mskDay(ms: number): string {
  return new Date(ms + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type CapRow = { day: string; count: number };
type CapStore = { free?: CapRow; sub?: CapRow };

const session = { free: 0, sub: 0 };

function readCaps(): CapStore {
  try {
    const raw = localStorage.getItem(CAP_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    return isObj(v) ? (v as CapStore) : {};
  } catch (e) {
    return {};
  }
}

function writeCaps(v: CapStore): void {
  try {
    localStorage.setItem(CAP_KEY, JSON.stringify(v));
  } catch (e) {
    /* private mode: the session cap still applies */
  }
}

function dayCount(audience: 'free' | 'sub', now: number): number {
  const row = readCaps()[audience];
  return row && row.day === mskDay(now) && typeof row.count === 'number' ? row.count : 0;
}

/** How many more impressions this audience may record. Infinity when both caps are off. */
/** Shown positions stay. Unshown ones are kept only while they fit in `left`. */
export function capAdmitted(list: number[], seen: (pos: number) => boolean, left: number): number[] {
  let pending = 0;
  const out: number[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (seen(p)) {
      out.push(p);
      continue;
    }
    if (pending >= left) continue;
    out.push(p);
    pending++;
  }
  return out;
}

export function impressionsLeft(group: YandexGroup, audience: 'free' | 'sub', now: number): number {
  let left = Number.POSITIVE_INFINITY;
  if (group.maxPerSession > 0) left = Math.min(left, Math.max(0, group.maxPerSession - session[audience]));
  if (group.maxPerDay > 0) left = Math.min(left, Math.max(0, group.maxPerDay - dayCount(audience, now)));
  return left;
}

export function noteYandexImpression(audience: 'free' | 'sub', now: number): void {
  session[audience] += 1;
  const store = readCaps();
  const day = mskDay(now);
  const prev = store[audience];
  const count = prev && prev.day === day ? prev.count + 1 : 1;
  store[audience] = { day, count };
  writeCaps(store);
}

/** Tests: session memory and the day counter start over. */
export function resetYandexCaps(): void {
  session.free = 0;
  session.sub = 0;
  try {
    localStorage.removeItem(CAP_KEY);
  } catch (e) {
    /* no storage */
  }
}

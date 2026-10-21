/**
 * Ads in the app catalog (Andy, 19.10.2026): our own banners (direct advertisers and affiliates) from the admin.
 * The config lives in settings.ads (one jsonb row in Postgres); images and the daily counters are in their own
 * tables (db/pg/ads.mjs). Off by default with no banners.
 *
 * The app reads GET /v1/ads-config (public, no secrets, cached 5 minutes) and sends impressions and clicks to
 * POST /v1/ads/event. The counters are per day, banner, section and platform: no device id, no IP. Kept 90 days.
 *
 * Every banner must carry the advertiser and its erid (the law on ad marking): the admin refuses to save one
 * without them, and the app shows «Реклама», the advertiser and the erid on the cell.
 */
import { createHash, randomBytes } from 'node:crypto';

export const AD_SECTIONS = ['mine', 'discoverGrid', 'discoverRails'];
export const AD_PLATFORMS = ['phone', 'androidTv', 'webos'];
/** house: our banners. yandex is reserved for a later phase (the apps ignore a provider they do not know). */
export const AD_PROVIDERS = ['house', 'yandex'];
export const AD_TV_MODES = ['qr', 'noclick'];

export const AD_LIMITS = {
  everyN: [6, 30],
  firstAfter: [1, 60],
  afterInstallDays: [0, 60],
  maxPerScreen: [1, 2],
  railsEvery: [2, 10],
  weight: [1, 100],
};

export const AD_STATS_DAYS = 90;
export const AD_CONFIG_TTL_SEC = 300;
export const AD_BANNERS_MAX = 50;
export const AD_IMAGE_MAX_BYTES = 300 * 1024;
export const AD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** One POST /v1/ads/event: at most this many rows, each counting at most AD_EVENT_MAX_N events. */
export const AD_EVENT_MAX_ROWS = 50;
export const AD_EVENT_MAX_N = 20;

export function adsDefaults() {
  return {
    /** The kill switch. Off: the apps show nothing (within the 5 minute cache). */
    enabled: false,
    provider: 'house',
    /** An ad after every N cards. */
    everyN: 10,
    /** The first ad not before this many cards. */
    firstAfter: 10,
    /** No ads in the first days after the app was installed. */
    afterInstallDays: 3,
    /** At most this many ad cells on one screen. */
    maxPerScreen: 1,
    /** «Обзор» home: an ad block after every N rails (the first after the second rail). */
    railsEvery: 3,
    sections: { mine: true, discoverGrid: true, discoverRails: true },
    /** TV is a later phase: off until its UI ships. */
    platforms: { phone: true, androidTv: false, webos: false },
    hideForSubscribers: true,
    /** TV: no ads when a phone with an active subscription is linked to that TV. */
    tvHideIfLinkedSubscriber: true,
    /** Older apps show nothing (empty: every version that knows ads). */
    minAppVersion: '',
    /** Yandex ad unit ids (R-M-...), not secrets. Unused until the Yandex phase. */
    yandex: { nativeUnitPhone: '', nativeUnitTv: '', bannerUnit: '' },
    banners: [],
  };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function bool(v, d) {
  if (v === true || v === 'true' || v === '1' || v === 1 || v === 'on' || v === 'yes') return true;
  if (v === false || v === 'false' || v === '0' || v === 0 || v === 'off' || v === 'no' || v === '') return false;
  return d;
}

function intIn(v, [lo, hi]) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

function flags(v, keys, d) {
  const out = {};
  const src = isObj(v) ? v : {};
  for (let i = 0; i < keys.length; i++) out[keys[i]] = bool(src[keys[i]], d[keys[i]]);
  return out;
}

/** A list of known names from an array or a comma string; unknown names are dropped. */
function names(v, known) {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const s = String(arr[i] || '').trim();
    if (known.indexOf(s) >= 0 && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

const VERSION_RE = /^\d{1,4}(\.\d{1,4}){0,2}$/;
const YANDEX_UNIT_RE = /^(R-M-[0-9A-Za-z-]{1,40})?$/;
/** erid tokens from the ORD: letters and digits (Base58-like), sometimes with _ or -. */
const ERID_RE = /^[0-9A-Za-z_-]{4,64}$/;
const ID_RE = /^[0-9a-z]{6,32}$/;
const IMAGE_ID_RE = /^[0-9a-f]{24}$/;

/** The stored config with every field present and valid (bad stored values fall back to the defaults). */
export function adsConfig(settings) {
  const d = adsDefaults();
  const raw = isObj(settings && settings.ads) ? settings.ads : {};
  const lim = (k) => {
    const n = intIn(raw[k], AD_LIMITS[k]);
    return n === null ? d[k] : n;
  };
  const y = isObj(raw.yandex) ? raw.yandex : {};
  const banners = Array.isArray(raw.banners) ? raw.banners.filter((b) => isObj(b) && ID_RE.test(String(b.id || ''))) : [];
  return {
    enabled: bool(raw.enabled, d.enabled),
    provider: AD_PROVIDERS.indexOf(raw.provider) >= 0 ? raw.provider : d.provider,
    everyN: lim('everyN'),
    firstAfter: lim('firstAfter'),
    afterInstallDays: lim('afterInstallDays'),
    maxPerScreen: lim('maxPerScreen'),
    railsEvery: lim('railsEvery'),
    sections: flags(raw.sections, AD_SECTIONS, d.sections),
    platforms: flags(raw.platforms, AD_PLATFORMS, d.platforms),
    hideForSubscribers: bool(raw.hideForSubscribers, d.hideForSubscribers),
    tvHideIfLinkedSubscriber: bool(raw.tvHideIfLinkedSubscriber, d.tvHideIfLinkedSubscriber),
    minAppVersion: typeof raw.minAppVersion === 'string' && VERSION_RE.test(raw.minAppVersion) ? raw.minAppVersion : '',
    yandex: {
      nativeUnitPhone: typeof y.nativeUnitPhone === 'string' && YANDEX_UNIT_RE.test(y.nativeUnitPhone) ? y.nativeUnitPhone : '',
      nativeUnitTv: typeof y.nativeUnitTv === 'string' && YANDEX_UNIT_RE.test(y.nativeUnitTv) ? y.nativeUnitTv : '',
      bannerUnit: typeof y.bannerUnit === 'string' && YANDEX_UNIT_RE.test(y.bannerUnit) ? y.bannerUnit : '',
    },
    banners,
  };
}

/**
 * The admin form for the general settings (not the banners) applied to the config.
 * { config } or { error } (Russian, for the flash); nothing is saved on an error.
 */
export function applyAdsSettings(settings, body) {
  const cur = adsConfig(settings);
  const b = isObj(body) ? body : {};
  const next = { ...cur, sections: { ...cur.sections }, platforms: { ...cur.platforms }, yandex: { ...cur.yandex } };
  const errors = [];
  if (b.enabled !== undefined) next.enabled = bool(b.enabled, cur.enabled);
  if (b.provider !== undefined) {
    if (AD_PROVIDERS.indexOf(b.provider) < 0) errors.push('неизвестная сеть');
    else next.provider = b.provider;
  }
  const LABELS = {
    everyN: 'каждая N-я карточка',
    firstAfter: 'первая реклама не раньше карточки',
    afterInstallDays: 'дней после установки',
    maxPerScreen: 'на экране не больше',
    railsEvery: 'между рельсами каждые',
  };
  for (const k of Object.keys(LABELS)) {
    if (b[k] === undefined || b[k] === '') continue;
    const n = intIn(b[k], AD_LIMITS[k]);
    if (n === null) errors.push(LABELS[k] + ': целое число ' + AD_LIMITS[k][0] + '-' + AD_LIMITS[k][1]);
    else next[k] = n;
  }
  if (b.sections !== undefined) next.sections = flags(b.sections, AD_SECTIONS, cur.sections);
  if (b.platforms !== undefined) next.platforms = flags(b.platforms, AD_PLATFORMS, cur.platforms);
  if (b.hideForSubscribers !== undefined) next.hideForSubscribers = bool(b.hideForSubscribers, cur.hideForSubscribers);
  if (b.tvHideIfLinkedSubscriber !== undefined) next.tvHideIfLinkedSubscriber = bool(b.tvHideIfLinkedSubscriber, cur.tvHideIfLinkedSubscriber);
  if (b.minAppVersion !== undefined) {
    const v = String(b.minAppVersion || '').trim().replace(/^v/i, '');
    if (v && !VERSION_RE.test(v)) errors.push('минимальная версия: например 0.20.5');
    else next.minAppVersion = v;
  }
  if (isObj(b.yandex)) {
    for (const k of ['nativeUnitPhone', 'nativeUnitTv', 'bannerUnit']) {
      if (b.yandex[k] === undefined) continue;
      const v = String(b.yandex[k] || '').trim();
      if (!YANDEX_UNIT_RE.test(v)) errors.push('блок Яндекса: формат R-M-...');
      else next.yandex[k] = v;
    }
  }
  if (errors.length) return { error: 'Реклама не сохранена: ' + errors.join('; ') };
  return { config: next };
}

/** One line for the audit: what changed (the banners are journaled on their own). */
export function adsSettingsDiff(before, after) {
  const out = [];
  if (before.enabled !== after.enabled) out.push(after.enabled ? 'включена' : 'выключена');
  for (const k of ['provider', 'everyN', 'firstAfter', 'afterInstallDays', 'maxPerScreen', 'railsEvery', 'minAppVersion']) {
    if (before[k] !== after[k]) out.push(k + ': ' + (before[k] === '' ? '-' : before[k]) + ' → ' + (after[k] === '' ? '-' : after[k]));
  }
  for (const group of ['sections', 'platforms']) {
    for (const k of Object.keys(after[group])) {
      if (before[group][k] !== after[group][k]) out.push(k + ': ' + (after[group][k] ? 'да' : 'нет'));
    }
  }
  if (before.hideForSubscribers !== after.hideForSubscribers) out.push('подписчикам: ' + (after.hideForSubscribers ? 'скрыта' : 'показана'));
  if (before.tvHideIfLinkedSubscriber !== after.tvHideIfLinkedSubscriber) {
    out.push('ТВ с подпиской на телефоне: ' + (after.tvHideIfLinkedSubscriber ? 'скрыта' : 'показана'));
  }
  for (const k of Object.keys(after.yandex)) if (before.yandex[k] !== after.yandex[k]) out.push('yandex.' + k);
  return out.length ? out.join(', ') : 'без изменений';
}

function text(v, max) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** A day (YYYY-MM-DD) or ms as epoch ms at 00:00 MSK; '' and null are «no date». undefined: a bad value. */
function dateMs(v, endOfDay) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
  if (!m) return undefined;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - MSK_OFFSET_MS + (endOfDay ? DAY_MS - 1 : 0);
  return Number.isFinite(ms) ? ms : undefined;
}

export function newBannerId() {
  return randomBytes(6).toString('hex');
}

/**
 * A banner from the admin form, validated. { banner } or { error } (Russian). The advertiser and the erid are
 * required (ad marking), and so are the title, the link and the image (the cell is a card with a picture).
 */
export function validateBanner(body, existing) {
  const b = isObj(body) ? body : {};
  const prev = isObj(existing) ? existing : {};
  const errors = [];
  const erid = text(b.erid, 64);
  if (!erid) errors.push('нет erid: без токена ОРД баннер не сохраняется');
  else if (!ERID_RE.test(erid)) errors.push('erid: только латинские буквы, цифры, _ и -, от 4 до 64 знаков');
  const advertiser = text(b.advertiser, 80);
  if (!advertiser) errors.push('нет рекламодателя');
  const title = text(b.title, 56);
  if (!title) errors.push('нет заголовка');
  const body2 = text(b.text, 140);
  const url = text(b.url, 500);
  if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(url)) errors.push('ссылка: адрес http(s)://');
  const image = text(b.image, 64);
  if (!IMAGE_ID_RE.test(image)) errors.push('нет картинки');
  let weight = AD_LIMITS.weight[0];
  if (b.weight !== undefined && b.weight !== '') {
    const w = intIn(b.weight, AD_LIMITS.weight);
    if (w === null) errors.push('вес: 1-100');
    else weight = w;
  } else if (typeof prev.weight === 'number') weight = prev.weight;
  const from = dateMs(b.from, false);
  const to = dateMs(b.to, true);
  if (from === undefined || to === undefined) errors.push('даты: ГГГГ-ММ-ДД');
  else if (from !== null && to !== null && to < from) errors.push('дата окончания раньше начала');
  const tvMode = AD_TV_MODES.indexOf(b.tvMode) >= 0 ? b.tvMode : prev.tvMode || 'qr';
  const platforms = b.platforms !== undefined ? names(b.platforms, AD_PLATFORMS) : AD_PLATFORMS.slice();
  const sections = b.sections !== undefined ? names(b.sections, AD_SECTIONS) : AD_SECTIONS.slice();
  if (!platforms.length) errors.push('не выбрана ни одна платформа');
  if (!sections.length) errors.push('не выбран ни один раздел');
  if (errors.length) return { error: 'Баннер не сохранён: ' + errors.join('; ') };
  const id = ID_RE.test(String(prev.id || '')) ? prev.id : newBannerId();
  return {
    banner: {
      id,
      enabled: bool(b.enabled, prev.enabled !== undefined ? !!prev.enabled : true),
      title,
      text: body2,
      advertiser,
      erid,
      url,
      image,
      weight,
      from,
      to,
      platforms,
      sections,
      tvMode,
      createdAt: typeof prev.createdAt === 'number' ? prev.createdAt : Date.now(),
    },
  };
}

/** settings with the banner added or replaced (by id). { settings } or { error }. */
export function saveBanner(settings, body) {
  const cfg = adsConfig(settings);
  const id = String((body && body.id) || '');
  const existing = id ? cfg.banners.find((x) => x.id === id) : null;
  if (id && !existing) return { error: 'Баннер не найден' };
  if (!existing && cfg.banners.length >= AD_BANNERS_MAX) return { error: 'Баннеров не больше ' + AD_BANNERS_MAX };
  const v = validateBanner(body, existing);
  if (v.error) return { error: v.error };
  const banners = existing ? cfg.banners.map((x) => (x.id === existing.id ? v.banner : x)) : cfg.banners.concat([v.banner]);
  return { settings: { ...settings, ads: { ...cfg, banners } }, banner: v.banner, created: !existing };
}

export function removeBanner(settings, id) {
  const cfg = adsConfig(settings);
  const found = cfg.banners.find((x) => x.id === String(id || ''));
  if (!found) return { error: 'Баннер не найден' };
  return { settings: { ...settings, ads: { ...cfg, banners: cfg.banners.filter((x) => x.id !== found.id) } }, banner: found };
}

/** Image ids the banners still use (the rest can be deleted). */
export function usedImageIds(settings) {
  return adsConfig(settings).banners.map((b) => b.image).filter((x) => IMAGE_ID_RE.test(String(x || '')));
}

/** A link with the erid as a query parameter (the ad marking travels with the click), unless it is there. */
export function linkWithErid(url, erid) {
  try {
    const u = new URL(url);
    if (!u.searchParams.has('erid')) u.searchParams.set('erid', erid);
    return u.toString();
  } catch (e) {
    return url;
  }
}

function bannerLive(b, now) {
  if (!b.enabled) return false;
  if (typeof b.from === 'number' && now < b.from) return false;
  if (typeof b.to === 'number' && now > b.to) return false;
  return true;
}

/**
 * What GET /v1/ads-config answers: the switches and the live banners (enabled, not past their end; ones that start
 * later are included with `from`, so a 5 minute cache does not hold them back). No ids of anything but banners.
 * Off (or no live banner): only { v, enabled: false, ttlSec }.
 */
export function publicAdsConfig(settings, now) {
  const at = Number(now) || Date.now();
  const cfg = adsConfig(settings);
  const banners = cfg.banners
    .filter((b) => b.enabled && !(typeof b.to === 'number' && at > b.to))
    .map((b) => ({
      id: b.id,
      title: b.title,
      text: b.text,
      advertiser: b.advertiser,
      erid: b.erid,
      url: linkWithErid(b.url, b.erid),
      image: '/v1/ads/img/' + b.image,
      weight: b.weight,
      from: b.from,
      to: b.to,
      platforms: b.platforms,
      sections: b.sections,
      tvMode: b.tvMode,
    }));
  if (!cfg.enabled || !banners.length) return { v: 1, enabled: false, ttlSec: AD_CONFIG_TTL_SEC };
  return {
    v: 1,
    enabled: true,
    provider: cfg.provider,
    everyN: cfg.everyN,
    firstAfter: cfg.firstAfter,
    afterInstallDays: cfg.afterInstallDays,
    maxPerScreen: cfg.maxPerScreen,
    railsEvery: cfg.railsEvery,
    sections: cfg.sections,
    platforms: cfg.platforms,
    hideForSubscribers: cfg.hideForSubscribers,
    tvHideIfLinkedSubscriber: cfg.tvHideIfLinkedSubscriber,
    minAppVersion: cfg.minAppVersion,
    banners,
    ttlSec: AD_CONFIG_TTL_SEC,
  };
}

/** A strong ETag of the JSON answer. */
export function etagOf(body) {
  return '"' + createHash('sha1').update(body).digest('base64url').slice(0, 27) + '"';
}

/** Whether the request's If-None-Match matches (a list or *). */
export function etagMatches(header, etag) {
  const h = String(header || '').trim();
  if (!h) return false;
  if (h === '*') return true;
  return h.split(',').some((x) => x.trim().replace(/^W\//, '') === etag);
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The MSK calendar day of `ms` as YYYY-MM-DD (the admin reads the stats in Moscow time). */
export function mskDay(ms) {
  return new Date((Number(ms) || Date.now()) + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** The first day kept by the 90 day retention at `now`. */
export function adStatsCutoffDay(now) {
  return mskDay((Number(now) || Date.now()) - (AD_STATS_DAYS - 1) * DAY_MS);
}

/**
 * POST /v1/ads/event: `events` is a JSON array (or its text in a form field) of { b: banner id, s: section,
 * p: platform, t: 'i' (impression) | 'c' (click), n?: count }. Rows for unknown banners, sections or platforms are
 * dropped. Returns the rows to add, merged per key: [{ banner, section, platform, impressions, clicks }].
 */
export function parseAdEvents(body, settings) {
  const raw = body && body.events;
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch (e) {
      list = null;
    }
  }
  if (!Array.isArray(list)) return { rows: [], dropped: 0, bad: true };
  const known = new Set(adsConfig(settings).banners.map((b) => b.id));
  const merged = new Map();
  let dropped = 0;
  const n0 = Math.min(list.length, AD_EVENT_MAX_ROWS);
  dropped += list.length - n0;
  for (let i = 0; i < n0; i++) {
    const e = list[i];
    if (!isObj(e)) {
      dropped++;
      continue;
    }
    const banner = String(e.b || '');
    const section = String(e.s || '');
    const platform = String(e.p || '');
    const type = e.t === 'c' ? 'c' : e.t === 'i' ? 'i' : '';
    const n = e.n === undefined ? 1 : intIn(e.n, [1, AD_EVENT_MAX_N]);
    if (!known.has(banner) || AD_SECTIONS.indexOf(section) < 0 || AD_PLATFORMS.indexOf(platform) < 0 || !type || n === null) {
      dropped++;
      continue;
    }
    const key = banner + '|' + section + '|' + platform;
    let row = merged.get(key);
    if (!row) merged.set(key, (row = { banner, section, platform, impressions: 0, clicks: 0 }));
    if (type === 'i') row.impressions += n;
    else row.clicks += n;
  }
  return { rows: Array.from(merged.values()), dropped, bad: false };
}

/** Sums of the stat rows ({ day, banner, section, platform, impressions, clicks }) for the admin. */
export function summarizeAdStats(rows, settings, days, now) {
  const at = Number(now) || Date.now();
  const n = Math.max(1, Math.min(AD_STATS_DAYS, Math.floor(Number(days) || 30)));
  const from = mskDay(at - (n - 1) * DAY_MS);
  const titles = new Map(adsConfig(settings).banners.map((b) => [b.id, b.title]));
  const byDay = new Map();
  const group = (map, key, r) => {
    let x = map.get(key);
    if (!x) map.set(key, (x = { key, impressions: 0, clicks: 0 }));
    x.impressions += r.impressions;
    x.clicks += r.clicks;
  };
  const byBanner = new Map();
  const bySection = new Map();
  const byPlatform = new Map();
  const total = { impressions: 0, clicks: 0 };
  for (const r of rows || []) {
    if (r.day < from) continue;
    group(byDay, r.day, r);
    group(byBanner, r.banner, r);
    group(bySection, r.section, r);
    group(byPlatform, r.platform, r);
    total.impressions += r.impressions;
    total.clicks += r.clicks;
  }
  const list = (m) => Array.from(m.values()).sort((a, b) => b.impressions - a.impressions || (a.key < b.key ? -1 : 1));
  const dayList = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = mskDay(at - i * DAY_MS);
    const x = byDay.get(d);
    dayList.push({ day: d, impressions: x ? x.impressions : 0, clicks: x ? x.clicks : 0 });
  }
  return {
    days: n,
    from,
    total,
    byDay: dayList,
    byBanner: list(byBanner).map((x) => ({ ...x, title: titles.get(x.key) || '(удалён)' })),
    bySection: list(bySection),
    byPlatform: list(byPlatform),
  };
}

/** The image upload from the admin: { mime, bytes, id } (id = hash of the bytes) or { error }. */
export function decodeAdImage(body) {
  const b = isObj(body) ? body : {};
  const mime = String(b.mime || '').toLowerCase();
  if (AD_IMAGE_TYPES.indexOf(mime) < 0) return { error: 'Картинка: только JPEG, PNG или WebP' };
  const data = String(b.data || '').replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) return { error: 'Картинка не прочитана' };
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length) return { error: 'Картинка пустая' };
  if (bytes.length > AD_IMAGE_MAX_BYTES) return { error: 'Картинка больше ' + Math.round(AD_IMAGE_MAX_BYTES / 1024) + ' КБ' };
  if (!sniffImage(bytes, mime)) return { error: 'Файл не похож на ' + mime.slice(6).toUpperCase() };
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  return { mime, bytes, id };
}

function sniffImage(buf, mime) {
  if (mime === 'image/png') return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (mime === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/webp') return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

export function isAdImageId(id) {
  return IMAGE_ID_RE.test(String(id || ''));
}

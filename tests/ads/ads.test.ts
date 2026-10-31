import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import {
  ADS_KEY,
  ADS_OFF,
  adPositions,
  adsConfigStale,
  adsFor,
  cachedAdsConfig,
  pickBanner,
  railPositions,
  sanitizeAdsConfig,
  saveAdsConfig,
  versionAtLeast,
  withAds,
  type AdContext,
} from '../../src/ads/ads';
import { adEvent, flushAdEvents, pendingAdEvents, resetAdEvents, setAdEventSender } from '../../src/ads/events';

const NOW = Date.UTC(2026, 9, 19, 16, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const BANNER = {
  id: 'abc123def456',
  title: 'Приставка',
  text: 'Скидка',
  advertiser: 'ООО Ромашка',
  erid: '2SDnjcVm1aB',
  url: 'https://shop.example/?erid=2SDnjcVm1aB',
  image: '/v1/ads/img/' + 'a'.repeat(24),
  weight: 1,
  from: null,
  to: null,
  platforms: ['phone'],
  sections: ['mine', 'discoverGrid', 'discoverRails'],
  tvMode: 'qr',
};

function server(over: Record<string, unknown> = {}) {
  return {
    v: 1,
    enabled: true,
    provider: 'house',
    everyN: 10,
    firstAfter: 10,
    afterInstallDays: 3,
    maxPerScreen: 1,
    railsEvery: 3,
    sections: { mine: true, discoverGrid: true, discoverRails: true },
    platforms: { phone: true, androidTv: false, webos: false },
    hideForSubscribers: true,
    tvHideIfLinkedSubscriber: true,
    minAppVersion: '',
    banners: [BANNER],
    ttlSec: 300,
    ...over,
  };
}

const ctx = (over: Partial<AdContext> = {}): AdContext => ({
  platform: 'phone',
  section: 'mine',
  appVersion: '0.20.5',
  subscribed: false,
  firstRun: NOW - 10 * DAY,
  now: NOW,
  ...over,
});

beforeEach(() => localStorage.clear());

describe('ads config from the server', () => {
  it('keeps a valid answer and makes the image absolute on the billing domain', () => {
    const cfg = sanitizeAdsConfig(server());
    expect(cfg.enabled).toBe(true);
    expect(cfg.banners[0].image).toBe('https://billing.omp-player.online/v1/ads/img/' + 'a'.repeat(24));
  });

  it('is off for anything unexpected: no v, off, no banners, a banner without erid or advertiser, a foreign image', () => {
    expect(sanitizeAdsConfig(null)).toBe(ADS_OFF);
    expect(sanitizeAdsConfig({ ...server(), v: 2 })).toBe(ADS_OFF);
    expect(sanitizeAdsConfig(server({ enabled: false }))).toBe(ADS_OFF);
    expect(sanitizeAdsConfig(server({ banners: [] })).enabled).toBe(false);
    expect(sanitizeAdsConfig(server({ banners: [{ ...BANNER, erid: '' }] })).enabled).toBe(false);
    expect(sanitizeAdsConfig(server({ banners: [{ ...BANNER, advertiser: '' }] })).enabled).toBe(false);
    expect(sanitizeAdsConfig(server({ banners: [{ ...BANNER, image: 'https://tracker.example/pixel.gif' }] })).enabled).toBe(false);
    expect(sanitizeAdsConfig(server({ banners: [{ ...BANNER, url: 'javascript:alert(1)' }] })).enabled).toBe(false);
  });

  it('a cached answer is used for an hour at most; refreshed after 5 minutes when on, 30 when off', () => {
    expect(adsConfigStale(NOW)).toBe(true);
    saveAdsConfig(server(), NOW);
    expect(cachedAdsConfig(NOW + 59 * 60 * 1000).enabled).toBe(true);
    expect(cachedAdsConfig(NOW + 61 * 60 * 1000).enabled).toBe(false);
    expect(adsConfigStale(NOW + 4 * 60 * 1000)).toBe(false);
    expect(adsConfigStale(NOW + 5 * 60 * 1000)).toBe(true);
    saveAdsConfig({ v: 1, enabled: false, ttlSec: 300 }, NOW);
    expect(adsConfigStale(NOW + 10 * 60 * 1000)).toBe(false);
    expect(adsConfigStale(NOW + 30 * 60 * 1000)).toBe(true);
    localStorage.setItem(ADS_KEY, '{broken');
    expect(cachedAdsConfig(NOW).enabled).toBe(false);
  });
});

describe('who sees ads', () => {
  const cfg = sanitizeAdsConfig(server());
  it('a phone past the first days, not subscribed, in an enabled section', () => {
    expect(adsFor(cfg, ctx())).toHaveLength(1);
  });
  it('nobody in the first days after install', () => {
    expect(adsFor(cfg, ctx({ firstRun: NOW - 2 * DAY }))).toEqual([]);
    expect(adsFor(sanitizeAdsConfig(server({ afterInstallDays: 0 })), ctx({ firstRun: NOW }))).toHaveLength(1);
  });
  it('not subscribers (unless the admin says so)', () => {
    expect(adsFor(cfg, ctx({ subscribed: true }))).toEqual([]);
    expect(adsFor(sanitizeAdsConfig(server({ hideForSubscribers: false })), ctx({ subscribed: true }))).toHaveLength(1);
  });
  it('a TV linked to a subscribed phone shows nothing, other TVs do', () => {
    const tv = sanitizeAdsConfig(server({
      platforms: { phone: true, androidTv: true, webos: true },
      banners: [{ ...BANNER, platforms: ['phone', 'androidTv', 'webos'] }],
    }));
    const onTv = ctx({ platform: 'androidTv' });
    expect(adsFor(tv, onTv)).toHaveLength(1);
    expect(adsFor(tv, { ...onTv, linkedSubscriber: true })).toEqual([]);
    expect(adsFor(tv, { ...onTv, subscribed: true })).toEqual([]);
    const show = sanitizeAdsConfig(server({
      platforms: { phone: true, androidTv: true, webos: false },
      tvHideIfLinkedSubscriber: false,
      banners: [{ ...BANNER, platforms: ['androidTv'] }],
    }));
    expect(adsFor(show, { ...onTv, linkedSubscriber: true })).toHaveLength(1);
  });
  it('not on a disabled section or platform, an old app, or another provider', () => {
    expect(adsFor(sanitizeAdsConfig(server({ sections: { mine: false, discoverGrid: true, discoverRails: true } })), ctx())).toEqual([]);
    expect(adsFor(cfg, ctx({ platform: 'androidTv' }))).toEqual([]);
    expect(adsFor(sanitizeAdsConfig(server({ minAppVersion: '0.21.0' })), ctx())).toEqual([]);
    expect(adsFor(sanitizeAdsConfig(server({ provider: 'yandex' })), ctx())).toEqual([]);
  });
  it('a banner only on its platforms, sections and dates', () => {
    const b = { ...BANNER, sections: ['discoverGrid'], from: NOW + DAY };
    const c2 = sanitizeAdsConfig(server({ banners: [b] }));
    expect(adsFor(c2, ctx({ section: 'mine' }))).toEqual([]);
    expect(adsFor(c2, ctx({ section: 'discoverGrid' }))).toEqual([]);
    expect(adsFor(c2, ctx({ section: 'discoverGrid', now: NOW + 2 * DAY }))).toHaveLength(1);
  });
  it('versions compare by numbers, a beta counts as its version', () => {
    expect(versionAtLeast('0.20.5', '0.20.5')).toBe(true);
    expect(versionAtLeast('0.20.10', '0.20.9')).toBe(true);
    expect(versionAtLeast('0.20.5-beta.2', '0.20.5')).toBe(true);
    expect(versionAtLeast('0.20.4', '0.20.5')).toBe(false);
    expect(versionAtLeast('1.0', '0.99.99')).toBe(true);
  });
});

describe('where the ads go', () => {
  const cfg = { everyN: 10, firstAfter: 10, maxPerScreen: 1 };
  it('after the 10th card, then every 10, never after the last card', () => {
    expect(adPositions(9, cfg, 6)).toEqual([]);
    expect(adPositions(10, cfg, 6)).toEqual([]);
    expect(adPositions(11, cfg, 6)).toEqual([10]);
    expect(adPositions(35, cfg, 6)).toEqual([10, 20, 30]);
  });
  it('at most one per screen: a view with more cards per screen spaces them wider', () => {
    expect(adPositions(50, cfg, 20)).toEqual([10, 30]);
    expect(adPositions(50, { ...cfg, maxPerScreen: 2 }, 20)).toEqual([10, 20, 30, 40]);
  });
  it('home rails: after the second rail, then every railsEvery', () => {
    expect(railPositions(2, 3)).toEqual([]);
    expect(railPositions(9, 3)).toEqual([2, 5, 8]);
  });
  it('interleaves the ads before the cards at the admitted positions', () => {
    expect(withAds(['a', 'b', 'c'], [2])).toEqual([{ item: 'a' }, { item: 'b' }, { ad: 2 }, { item: 'c' }]);
  });
  it('picks a banner by weight, the same one for a slot all day', () => {
    const a = { ...sanitizeAdsConfig(server()).banners[0], id: 'aaaaaa', weight: 1 };
    const b = { ...a, id: 'bbbbbb', weight: 99 };
    expect(pickBanner([], 'mine:10', NOW)).toBeNull();
    expect(pickBanner([a, b], 'mine:10', NOW)).toBe(pickBanner([a, b], 'mine:10', NOW + 1000));
    let heavy = 0;
    for (let i = 0; i < 200; i++) if (pickBanner([a, b], 'mine:' + i, NOW)!.id === 'bbbbbb') heavy++;
    expect(heavy).toBeGreaterThan(180);
  });
});

describe('ad events', () => {
  afterEach(() => {
    resetAdEvents();
    setAdEventSender(null);
    vi.useRealTimers();
  });
  it('sums per banner, section, platform and type, sends one batch with no device id, drops a failed one', async () => {
    vi.useFakeTimers();
    const sent: { events: string }[] = [];
    setAdEventSender((form) => {
      sent.push(form);
      return Promise.reject(new Error('offline'));
    });
    adEvent('abc123', 'mine', 'phone', 'i');
    adEvent('abc123', 'mine', 'phone', 'i');
    adEvent('abc123', 'discoverGrid', 'phone', 'i');
    expect(pendingAdEvents()).toEqual([
      { b: 'abc123', s: 'mine', p: 'phone', t: 'i', n: 2 },
      { b: 'abc123', s: 'discoverGrid', p: 'phone', t: 'i', n: 1 },
    ]);
    // a click goes out within seconds
    adEvent('abc123', 'mine', 'phone', 'c');
    await vi.advanceTimersByTimeAsync(2500);
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0])).toEqual(['events']);
    expect(JSON.parse(sent[0].events)).toHaveLength(3);
    expect(pendingAdEvents()).toEqual([]);
    await flushAdEvents();
    expect(sent).toHaveLength(1);
  });
});

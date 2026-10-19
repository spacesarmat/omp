import { describe, expect, it } from 'vitest';
import {
  adsConfig,
  adsDefaults,
  adsSettingsDiff,
  adStatsCutoffDay,
  applyAdsSettings,
  decodeAdImage,
  etagMatches,
  etagOf,
  linkWithErid,
  mskDay,
  parseAdEvents,
  publicAdsConfig,
  removeBanner,
  saveBanner,
  summarizeAdStats,
  usedImageIds,
} from '../src/ads.mjs';

const NOW = Date.UTC(2026, 9, 19, 16, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const IMG = 'a'.repeat(24);

function banner(over: Record<string, unknown> = {}) {
  return { title: 'Приставка для ТВ', text: 'Скидка 10%', advertiser: 'ООО Ромашка', erid: '2SDnjcVm1aB', url: 'https://shop.example/tv', image: IMG, ...over };
}

function withBanner(over: Record<string, unknown> = {}) {
  const r = saveBanner({}, banner(over));
  if (!r.settings) throw new Error(r.error);
  return r;
}

describe('ads config', () => {
  it('is off by default with no banners, phone only, every 10th card after 3 days', () => {
    const cfg = adsConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.banners).toEqual([]);
    expect(cfg.everyN).toBe(10);
    expect(cfg.firstAfter).toBe(10);
    expect(cfg.afterInstallDays).toBe(3);
    expect(cfg.maxPerScreen).toBe(1);
    expect(cfg.platforms).toEqual({ phone: true, androidTv: false, webos: false });
    expect(cfg.hideForSubscribers).toBe(true);
    expect(cfg.tvHideIfLinkedSubscriber).toBe(true);
    expect(publicAdsConfig({}, NOW)).toEqual({ v: 1, enabled: false, ttlSec: 300 });
  });

  it('falls back to the defaults for bad stored values', () => {
    const cfg = adsConfig({ ads: { everyN: 2, firstAfter: 'x', provider: 'google', minAppVersion: 'abc', sections: { mine: false } } });
    expect(cfg.everyN).toBe(adsDefaults().everyN);
    expect(cfg.firstAfter).toBe(10);
    expect(cfg.provider).toBe('house');
    expect(cfg.minAppVersion).toBe('');
    expect(cfg.sections).toEqual({ mine: false, discoverGrid: true, discoverRails: true });
  });

  it('applies the admin form and refuses values out of range', () => {
    const ok = applyAdsSettings({}, { enabled: 'true', everyN: '12', afterInstallDays: '0', minAppVersion: 'v0.20.5', platforms: { androidTv: true } });
    expect(ok.config!.enabled).toBe(true);
    expect(ok.config!.everyN).toBe(12);
    expect(ok.config!.afterInstallDays).toBe(0);
    expect(ok.config!.minAppVersion).toBe('0.20.5');
    expect(ok.config!.platforms).toEqual({ phone: true, androidTv: true, webos: false });
    expect(adsSettingsDiff(adsConfig({}), ok.config!)).toContain('включена');
    expect(adsSettingsDiff(adsConfig({}), ok.config!)).toContain('everyN: 10 → 12');
    const bad = applyAdsSettings({}, { everyN: '3' });
    expect(bad.error).toContain('6-30');
    expect(applyAdsSettings({}, { provider: 'admob' }).error).toContain('неизвестная сеть');
    expect(applyAdsSettings({}, { yandex: { nativeUnitPhone: 'bad' } }).error).toContain('R-M-');
  });
});

describe('ads banners', () => {
  it('refuses a banner without an erid, advertiser, title, link or image', () => {
    expect(saveBanner({}, banner({ erid: '' })).error).toContain('erid');
    expect(saveBanner({}, banner({ erid: 'неверный' })).error).toContain('erid');
    expect(saveBanner({}, banner({ advertiser: ' ' })).error).toContain('рекламодателя');
    expect(saveBanner({}, banner({ title: '' })).error).toContain('заголовка');
    expect(saveBanner({}, banner({ url: 'javascript:alert(1)' })).error).toContain('ссылка');
    expect(saveBanner({}, banner({ image: '' })).error).toContain('картинки');
    expect(saveBanner({}, banner({ from: '2026-10-20', to: '2026-10-19' })).error).toContain('раньше');
    expect(saveBanner({}, banner({ platforms: [] })).error).toContain('платформа');
  });

  it('adds, edits and removes a banner by id; the title is cut to 56 characters', () => {
    const add = withBanner({ title: 'Я'.repeat(80), weight: '5', from: '2026-10-20', sections: 'mine,discoverGrid,bogus' });
    expect(add.created).toBe(true);
    const b = add.banner!;
    expect(b.title.length).toBe(56);
    expect(b.weight).toBe(5);
    expect(b.sections).toEqual(['mine', 'discoverGrid']);
    // 20.10.2026 00:00 MSK
    expect(b.from).toBe(Date.UTC(2026, 9, 19, 21, 0, 0));
    const edit = saveBanner(add.settings!, { ...banner({ title: 'Новый' }), id: b.id });
    expect(edit.created).toBe(false);
    expect(adsConfig(edit.settings!).banners.map((x: { title: string }) => x.title)).toEqual(['Новый']);
    expect(saveBanner(add.settings!, { ...banner(), id: 'ffffffffffff' }).error).toBe('Баннер не найден');
    expect(usedImageIds(edit.settings!)).toEqual([IMG]);
    const gone = removeBanner(edit.settings!, b.id);
    expect(adsConfig(gone.settings!).banners).toEqual([]);
    expect(removeBanner(gone.settings!, b.id).error).toBe('Баннер не найден');
  });

  it('serves only live banners with the erid in the link and the image path, nothing when off', () => {
    const one = withBanner();
    const settings = { ...one.settings!, ads: { ...one.settings!.ads, enabled: true } };
    const pub = publicAdsConfig(settings, NOW);
    expect(pub.enabled).toBe(true);
    expect(pub.banners).toHaveLength(1);
    expect(pub.banners![0].url).toBe('https://shop.example/tv?erid=2SDnjcVm1aB');
    expect(pub.banners![0].image).toBe('/v1/ads/img/' + IMG);
    expect(pub.banners![0].advertiser).toBe('ООО Ромашка');
    expect(Object.keys(pub).sort()).not.toContain('yandex');
    const expired = { ...settings, ads: { ...settings.ads, banners: [{ ...settings.ads.banners[0], to: NOW - 1 }] } };
    expect(publicAdsConfig(expired, NOW).enabled).toBe(false);
    const disabled = { ...settings, ads: { ...settings.ads, banners: [{ ...settings.ads.banners[0], enabled: false }] } };
    expect(publicAdsConfig(disabled, NOW).enabled).toBe(false);
    expect(publicAdsConfig(one.settings!, NOW)).toEqual({ v: 1, enabled: false, ttlSec: 300 });
    expect(linkWithErid('https://x.example/?erid=keep', 'other')).toBe('https://x.example/?erid=keep');
  });
});

describe('ads events and stats', () => {
  it('keeps only known banners, sections, platforms and types, merged per key', () => {
    const one = withBanner();
    const id = one.banner!.id;
    const events = JSON.stringify([
      { b: id, s: 'mine', p: 'phone', t: 'i' },
      { b: id, s: 'mine', p: 'phone', t: 'i', n: 3 },
      { b: id, s: 'mine', p: 'phone', t: 'c' },
      { b: id, s: 'history', p: 'phone', t: 'i' },
      { b: 'nope00', s: 'mine', p: 'phone', t: 'i' },
      { b: id, s: 'mine', p: 'phone', t: 'x' },
      { b: id, s: 'mine', p: 'phone', t: 'i', n: 500 },
      'junk',
    ]);
    const r = parseAdEvents({ events }, one.settings);
    expect(r.rows).toEqual([{ banner: id, section: 'mine', platform: 'phone', impressions: 4, clicks: 1 }]);
    expect(r.dropped).toBe(5);
    expect(parseAdEvents({ events: '{' }, one.settings).bad).toBe(true);
    const many = Array.from({ length: 80 }, () => ({ b: id, s: 'mine', p: 'phone', t: 'i' }));
    const capped = parseAdEvents({ events: many }, one.settings);
    expect(capped.rows[0].impressions).toBe(50);
    expect(capped.dropped).toBe(30);
  });

  it('sums the rows per day, banner, section and platform over the chosen days', () => {
    const one = withBanner();
    const id = one.banner!.id;
    const today = mskDay(NOW);
    const old = mskDay(NOW - 40 * DAY);
    const rows = [
      { day: today, banner: id, section: 'mine', platform: 'phone', impressions: 10, clicks: 1 },
      { day: today, banner: id, section: 'discoverGrid', platform: 'phone', impressions: 5, clicks: 0 },
      { day: old, banner: 'gone00', section: 'mine', platform: 'phone', impressions: 99, clicks: 9 },
    ];
    const s = summarizeAdStats(rows, one.settings, 30, NOW);
    expect(s.total).toEqual({ impressions: 15, clicks: 1 });
    expect(s.byDay).toHaveLength(30);
    expect(s.byDay[29]).toEqual({ day: today, impressions: 15, clicks: 1 });
    expect(s.byBanner).toEqual([{ key: id, impressions: 15, clicks: 1, title: 'Приставка для ТВ' }]);
    expect(s.bySection.map((x: { key: string }) => x.key)).toEqual(['mine', 'discoverGrid']);
    const all = summarizeAdStats(rows, one.settings, 90, NOW);
    expect(all.byBanner.find((x: { key: string }) => x.key === 'gone00').title).toBe('(удалён)');
  });

  it('days are Moscow days and 90 are kept', () => {
    expect(mskDay(Date.UTC(2026, 9, 19, 20, 59))).toBe('2026-10-19');
    expect(mskDay(Date.UTC(2026, 9, 19, 21, 0))).toBe('2026-10-20');
    expect(adStatsCutoffDay(NOW)).toBe(mskDay(NOW - 89 * DAY));
  });
});

describe('ads images and etag', () => {
  it('takes JPEG, PNG and WebP up to 300 KB that look like what they say', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
    const ok = decodeAdImage({ mime: 'image/png', data: 'data:image/png;base64,' + png.toString('base64') });
    expect(ok.id).toMatch(/^[0-9a-f]{24}$/);
    expect(decodeAdImage({ mime: 'image/jpeg', data: png.toString('base64') }).error).toContain('JPEG');
    expect(decodeAdImage({ mime: 'image/svg+xml', data: png.toString('base64') }).error).toContain('только');
    const big = Buffer.concat([png, Buffer.alloc(301 * 1024)]);
    expect(decodeAdImage({ mime: 'image/png', data: big.toString('base64') }).error).toContain('КБ');
  });

  it('matches If-None-Match', () => {
    const e = etagOf('{"a":1}');
    expect(etagMatches(e, e)).toBe(true);
    expect(etagMatches('W/' + e + ', "x"', e)).toBe(true);
    expect(etagMatches('"x"', e)).toBe(false);
    expect(etagMatches('', e)).toBe(false);
  });
});

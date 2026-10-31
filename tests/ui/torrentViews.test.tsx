import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { TorrentViews } from '../../src/screens/library/TorrentViews';
import type { Torrent } from '../../src/api/types';
import { adPositions, sanitizeAdsConfig, saveAdsConfig } from '../../src/ads/ads';
import { FIRST_RUN_KEY } from '../../src/ads/firstRun';
import { markTvAdImagesLoaded, TV_PER_SCREEN } from '../../src/ads/useTvAds';
import { setTvAdsIo, tvAdsConfig } from '../../src/ads/tvAds';
import { forgetPhoneLink } from '../../src/phone/phoneStore';

beforeAll(() => init({ debug: false, visualDebug: false }));

const list = [
  { hash: 'a', title: 'Signal.One.2026.x265.WEB-DL.2160p.SDR.mkv', stat: 5, torrent_size: 9.8 * 1024 ** 3, category: 'movie' },
  { hash: 'b', title: 'Futurama.S14E09.1080p.ColdFilm.mkv', stat: 5, torrent_size: 913 * 1024 ** 2, category: 'tv' },
];

function mount(view: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onOpen = vi.fn();
  render(h(TorrentViews as any, { view, list, onOpen, onFocused: vi.fn() }), host);
  return { host, onOpen };
}

describe('TorrentViews', () => {
  it('large tiles: initials once, two badges, the year under the title', () => {
    const { host } = mount('large');
    const tiles = host.querySelectorAll('.tile.tile-large');
    expect(tiles).toHaveLength(2);
    expect(tiles[0].querySelector('.art-initials')!.textContent).toBe('SO');
    expect(tiles[0].querySelector('.art-title')).toBeNull();
    const badges = Array.prototype.map.call(tiles[0].querySelectorAll('.badge'), (e: Element) => e.textContent);
    expect(badges).toEqual(['4K', 'HEVC']);
    expect(badges.join(' ')).not.toContain('2026');
    expect(tiles[0].querySelector('.tile-title')!.textContent).toBe('Signal One');
    expect(tiles[0].querySelector('.tile-meta')!.textContent).toBe('2026');
  });
  it('small tiles: one badge and a meta line', () => {
    const { host } = mount('small');
    const tile = host.querySelector('.tile.tile-small')!;
    expect(tile.querySelectorAll('.badge')).toHaveLength(1);
    expect(tile.querySelector('.tile-meta')!.textContent).toBe('2026');
  });
  it('list rows show category and size', () => {
    const { host } = mount('list');
    const row = host.querySelectorAll('.lrow')[1];
    expect(row.querySelector('.lrow-cat')!.textContent).toBe('Сериалы');
    expect(row.querySelector('.lrow-size')!.textContent).toBe('913 МБ');
  });
  it('compact rows open on click', () => {
    const { host, onOpen } = mount('compact');
    const rows = host.querySelectorAll('.crow');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('.badge').length).toBeLessThanOrEqual(2);
    (rows[1] as HTMLElement).click();
    expect(onOpen).toHaveBeenCalledWith(list[1]);
  });
});

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
  platforms: ['webos', 'androidTv'],
  sections: ['mine'],
  tvMode: 'qr',
};
const AD_CFG = {
  v: 1,
  enabled: true,
  provider: 'house',
  everyN: 10,
  firstAfter: 10,
  afterInstallDays: 3,
  maxPerScreen: 1,
  railsEvery: 3,
  sections: { mine: true, discoverGrid: true, discoverRails: true },
  platforms: { phone: false, androidTv: true, webos: true },
  hideForSubscribers: true,
  tvHideIfLinkedSubscriber: true,
  minAppVersion: '',
  banners: [BANNER],
  ttlSec: 300,
};

describe('TorrentViews ads on grouped films', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    forgetPhoneLink();
    setTvAdsIo(null);
    tvAdsConfig.value = sanitizeAdsConfig(null);
    vi.restoreAllMocks();
  });

  it('counts one card per film: 15 films of two releases each get one ad before the 11th card', async () => {
    const films = 15;
    const raw: Torrent[] = [];
    for (let i = 0; i < films; i++) {
      const name = 'Film Number ' + (i + 1);
      raw.push({ hash: 'a' + i, title: name + ' (2020) WEB-DL 1080p', category: 'movie', stat: 3, torrent_size: 1, timestamp: 200 - i });
      raw.push({ hash: 'b' + i, title: name + ' (2020) BDRip 2160p', category: 'movie', stat: 3, torrent_size: 2, timestamp: 50 - i });
    }
    // raw torrents would place a second ad; grouped cards do not
    const cfg = { everyN: 10, firstAfter: 10, maxPerScreen: 1 };
    expect(adPositions(films, cfg, TV_PER_SCREEN.list)).toEqual([10]);
    expect(adPositions(raw.length, cfg, TV_PER_SCREEN.list)).toEqual([10, 20]);

    localStorage.clear();
    forgetPhoneLink();
    localStorage.setItem(FIRST_RUN_KEY, String(Date.now() - 10 * DAY));
    const saved = sanitizeAdsConfig(AD_CFG);
    saveAdsConfig(AD_CFG);
    tvAdsConfig.value = saved;
    markTvAdImagesLoaded(saved.banners.map((b) => b.image));
    setTvAdsIo({ get: async () => ({ status: 200, text: JSON.stringify(AD_CFG) }), post: async () => undefined });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top: 2000, bottom: 2100, left: 0, right: 100, width: 100, height: 100, x: 0, y: 2000, toJSON: () => ({}) }) as DOMRect);
    document.body.innerHTML = '';

    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      render(h(TorrentViews as any, { view: 'list', list: raw, ads: true, group: true, onOpen: vi.fn(), onFocused: vi.fn() }), host);
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });

    const cards = host.querySelectorAll('.lrow:not(.ad-row)');
    const ads = host.querySelectorAll('.lrow.ad-row');
    expect(cards).toHaveLength(films);
    expect(ads).toHaveLength(1);
    const children = Array.from(host.querySelector('.views-rows')!.children);
    expect(children.findIndex((c) => c.classList.contains('ad-row'))).toBe(10);
    expect(cards[0].textContent).toContain('2 раздачи');
    expect(host.querySelector('[data-fk="ad-mine-10"]')).toBeTruthy();
    expect(host.querySelector('[data-fk="torrent-a10"]')).toBeTruthy();
    await act(async () => {
      render(null, host);
    });
  });
});

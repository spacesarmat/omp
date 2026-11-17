// The «Новое» feed is the release catalog: its visible rows get the same server seed check as the
// search top (one round per category visit, the same 30-row batch and per-device rate). The HTTP
// call is mocked; watchSeedVerify and applySeedRound run for real.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../src/billing/client', async (orig) => ({
  ...(await orig<typeof import('../../src/billing/client')>()),
  billingPost: vi.fn(),
}));

import { billingPost } from '../../src/billing/client';
import { saveBillingSession } from '../../src/billing/session';
import { News, resetNews } from '../src/screens/News';
import { setWatchActions } from '../src/watch';
import { resetTo } from '../src/nav';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrents } from '../../src/store/library';
import { reloadSourcePrefs, resetHealth, setSourceOn } from '../../src/sources/store';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { saveFeed } from '../../src/monitor/feedCache';
import { reloadTvs } from '../src/tv/tvStore';
import { fakeMonitor, type FakeMonitor } from './fakeMonitor';
import type { FeedCategory, Source, SourceResult } from '../../src/sources/types';

const HASH = 'a'.repeat(40);
const TV_HASH = 'd'.repeat(40);
const post = billingPost as unknown as ReturnType<typeof vi.fn>;
let el: HTMLElement;
let mon: FakeMonitor;

function row(p: Partial<SourceResult>): SourceResult {
  return {
    Title: 'Тихая гавань (2026) WEB-DL 2160p',
    Categories: '',
    Size: '18,2 ГБ',
    CreateDate: '',
    Tracker: '',
    Link: '',
    Magnet: 'magnet:?xt=urn:btih:' + HASH + '&tr=' + encodeURIComponent('http://tracker.example/announce'),
    Hash: HASH,
    Peer: 0,
    Seed: 940,
    source: 'feedy',
    ...p,
  };
}

function feedSource(byCat: Partial<Record<FeedCategory, SourceResult[]>>): Source {
  return {
    id: 'feedy',
    name: 'Ленточный',
    kind: 'builtin',
    search: () => Promise.resolve([]),
    latest: (_ctx, cat) => Promise.resolve(byCat[cat] || []),
  };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });

async function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => render(<News />, el));
  await flush();
}

function answer(hash: string, seeders: number) {
  return {
    status: 200,
    url: '',
    text: JSON.stringify({
      items: [
        { infohash: hash, verified: true, live: true, seeders: seeders, leechers: 3, completed: 14703, seedersMax: seeders, seedersMedian: seeders, peers: 0, samples: 1, measuredAt: 50 },
      ],
    }),
  };
}

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  resetNews();
  reloadTvs();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  setSourceOn('ts-rutor', false);
  setSourceOn('ts-torznab', false);
  torrents.value = [];
  setWatchActions({ ompVersion: async () => null, reportUrl: async () => null, launchOnTv: async () => undefined, remoteDelayMs: 0 });
  resetTo({ name: 'news' });
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  post.mockReset();
  mon = fakeMonitor();
});

afterEach(() => {
  act(() => render(null, el));
  unregisterSource('feedy');
  saveBillingSession(null);
  mon.restore();
  vi.restoreAllMocks();
  setWatchActions(null);
});

describe('«Новое» · проверка сидов каталога', () => {
  it('asks the server for the visible feed rows and shows the checked counts', async () => {
    saveBillingSession({ token: 'tok', paidUntil: 1, access: 'a', accessExp: Date.now() + 60 * 60 * 1000 });
    registerSource(feedSource({ movie: [row({})] }));
    saveFeed('movie', [row({})], Date.now() - 60000);
    post.mockResolvedValue(answer(HASH, 12));
    await mount();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toBe('/v1/seed-check');
    const items = JSON.parse((post.mock.calls[0][2] as { items: string }).items) as { infohash: string; trackers: string[] }[];
    expect(items).toHaveLength(1);
    expect(items[0].infohash).toBe(HASH);
    expect(items[0].trackers).toEqual(['http://tracker.example/announce']);
    await flush();
    expect(el.textContent).toContain('12 сидов');
    expect(el.textContent).toContain('скачано 14703 раза');
    expect(el.querySelector('.seed-live')).toBeTruthy();
  });

  it('without a session nothing is asked and the tracker numbers stay', async () => {
    saveBillingSession(null);
    registerSource(feedSource({ movie: [row({})] }));
    saveFeed('movie', [row({})], Date.now() - 60000);
    await mount();
    expect(post).not.toHaveBeenCalled();
    expect(el.textContent).toContain('940');
    expect(el.textContent).not.toContain('не проверено');
  });

  it('a category switch checks the new rows, one round per visit', async () => {
    saveBillingSession({ token: 'tok', paidUntil: 1, access: 'a', accessExp: Date.now() + 60 * 60 * 1000 });
    registerSource(feedSource({ movie: [row({})], tv: [row({ Title: 'Сериал 1080p', Hash: TV_HASH, Magnet: 'magnet:?xt=urn:btih:' + TV_HASH })] }));
    saveFeed('movie', [row({})], Date.now() - 60000);
    saveFeed('tv', [row({ Title: 'Сериал 1080p', Hash: TV_HASH, Magnet: 'magnet:?xt=urn:btih:' + TV_HASH })], Date.now() - 60000);
    post.mockImplementation((_ctx: unknown, path: string, body: { items: string }) => {
      const items = JSON.parse(body.items) as { infohash: string }[];
      return Promise.resolve(answer(items[0].infohash, 20));
    });
    await mount();
    expect(post).toHaveBeenCalledTimes(1);
    const tvChip = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Сериалы');
    act(() => (tvChip as HTMLElement).click());
    await flush();
    expect(post).toHaveBeenCalledTimes(2);
    const items = JSON.parse((post.mock.calls[1][2] as { items: string }).items) as { infohash: string }[];
    expect(items[0].infohash).toBe(TV_HASH);
    await flush();
    expect(el.textContent).toContain('20 сидов');
  });
});

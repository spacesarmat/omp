import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../src/store/journal', async (orig) => ({
  ...(await orig<typeof import('../../src/store/journal')>()),
  saveWatch: vi.fn(),
}));
vi.mock('../../src/monitor/replace', async (orig) => ({
  ...(await orig<typeof import('../../src/monitor/replace')>()),
  replaceWithResult: vi.fn(),
}));

import { News, resetNews } from '../src/screens/News';
import { setShareSender } from '../src/share/send';
import { currentRoute, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { setWatchActions } from '../src/watch';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { fakeMonitor, type FakeMonitor } from './fakeMonitor';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrents } from '../../src/store/library';
import { saveWatch } from '../../src/store/journal';
import { replaceWithResult } from '../../src/monitor/replace';
import { RUN_MAX_MS } from '../src/screens/News';
import { monitorFinished, reloadMonitor } from '../src/monitor/ui';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth, setSourceOn } from '../../src/sources/store';
import { saveFeed, loadFeed } from '../../src/monitor/feedCache';
import { addFindings, addSubscription, findingsOf, loadFound, loadSubs, setSubscriptionPoster, unseenCount } from '../../src/monitor/subs';
import { installSubPosters } from '../../src/monitor/subPoster';
import { acceptConfirm, declineConfirm, mountConfirmHost, unmountConfirmHost } from './confirmHost';
import { SUB_SWIPE_THRESHOLD } from '../src/ui/subSwipe';
import { saveLastRun } from '../../src/monitor/settings';
import type { FeedCategory, Source, SourceResult } from '../../src/sources/types';
import type { Finding } from '../../src/monitor/types';

const HASH = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
let el: HTMLElement;
let mon: FakeMonitor;
const launch = vi.fn();
const saveWatchMock = saveWatch as unknown as ReturnType<typeof vi.fn>;
const replaceMock = replaceWithResult as unknown as ReturnType<typeof vi.fn>;

function row(p: Partial<SourceResult>): SourceResult {
  return { Title: 'Тихая гавань (2026) WEB-DL 2160p', Categories: '', Size: '18,2 ГБ', CreateDate: '', Tracker: '', Link: '', Magnet: 'magnet:?xt=urn:btih:' + HASH, Hash: HASH, Peer: 0, Seed: 940, source: 'feedy', ...p };
}

function feedSource(byCat: Partial<Record<FeedCategory, SourceResult[]>>, calls: string[] = []): Source {
  return {
    id: 'feedy',
    name: 'Ленточный',
    kind: 'builtin',
    search: () => Promise.resolve([]),
    latest: (_ctx, cat) => {
      calls.push(cat);
      return Promise.resolve(byCat[cat] || []);
    },
  };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
const byText = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t);
const click = (n: Element | undefined | null) => {
  if (!n) throw new Error('missing element');
  act(() => (n as HTMLElement).click());
};

async function mount(p: { seg?: 'feed' | 'subs'; finding?: string; watch?: boolean } = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => render(<News {...p} />, el));
  await flush();
}

function episodesFinding(p: Partial<Finding> = {}): Finding {
  return {
    subId: 'episodes',
    key: OLD + ':2:10',
    at: 1000,
    result: row({ Title: 'Starbound Frontier / Сезон 2 / Серии 1-10 из 10 / 1080p', Hash: HASH, source: 'feedy' }),
    episodes: { torrentHash: OLD, torrentTitle: 'Starbound Frontier / Сезон 2 / Серии 1-8 из 10 / 1080p', season: 2, haveTo: 8, from: 1, to: 10 },
    ...p,
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
  toast.value = '';
  launch.mockReset().mockResolvedValue(undefined);
  setWatchActions({ ompVersion: async () => null, reportUrl: async () => null, launchOnTv: launch, remoteDelayMs: 0 });
  saveWatchMock.mockReset();
  replaceMock.mockReset();
  resetTo({ name: 'news' });
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  mon = fakeMonitor();
});

afterEach(() => {
  installSubPosters(null);
  unmountConfirmHost();
  setShareSender(null);
  vi.useRealTimers();
  act(() => render(null, el));
  unregisterSource('feedy');
  mon.restore();
  vi.restoreAllMocks();
  setWatchActions(null);
});

describe('«Новое» · Лента', () => {
  it('asks the feed sources on open, shows the rows newest first and fills the cache', async () => {
    const calls: string[] = [];
    registerSource(
      feedSource(
        {
          movie: [row({ Title: 'Старый фильм 1080p', date: 1000, Hash: 'c'.repeat(40), Magnet: '' }), row({ Title: 'Свежий фильм 2160p', date: 5000 })],
        },
        calls,
      ),
    );
    await mount();
    expect(calls).toEqual(['movie']);
    const titles = Array.from(el.querySelectorAll('.m-result-card')).map((n) => n.getAttribute('data-title'));
    expect(titles).toEqual(['Свежий фильм 2160p', 'Старый фильм 1080p']);
    expect(el.querySelector('.m-news-status')!.textContent).toContain('Свежее с Ленточный · обновлено в');
    expect(loadFeed('movie')!.results).toHaveLength(2);
    expect(el.querySelector('[role=tab][aria-selected=true]')!.textContent).toBe('Лента');
  });

  it('a fresh cache is shown without asking again; «Обновить» asks', async () => {
    const calls: string[] = [];
    registerSource(feedSource({ movie: [row({ Title: 'Новый' })] }, calls));
    saveFeed('movie', [row({ Title: 'Из кэша' })], Date.now() - 60000);
    await mount();
    expect(calls).toEqual([]);
    expect(el.querySelector('.m-result-title')!.textContent).toBe('Из кэша');
    click(byText('Обновить'));
    await flush();
    expect(calls).toEqual(['movie']);
    expect(el.querySelector('.m-result-title')!.textContent).toBe('Новый');
  });

  it('category chips switch the feed; «1080p+» filters', async () => {
    const calls: string[] = [];
    registerSource(feedSource({ movie: [row({})], tv: [row({ Title: 'Сериал 720p', Hash: 'd'.repeat(40) }), row({ Title: 'Сериал 1080p', Hash: 'e'.repeat(40) })] }, calls));
    await mount();
    click(byText('Сериалы'));
    await flush();
    expect(calls).toEqual(['movie', 'tv']);
    expect(el.querySelectorAll('.m-result')).toHaveLength(2);
    click(byText('1080p+'));
    const titles = Array.from(el.querySelectorAll('.m-result-card')).map((n) => n.getAttribute('data-title'));
    expect(titles).toEqual(['Сериал 1080p']);
  });

  it('«Добавить» adds through the Add path with the feed category', async () => {
    registerSource(feedSource({ movie: [row({})] }));
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    await mount();
    click(el.querySelector('[aria-label^="Добавить на сервер:"]'));
    await flush();
    expect(add).toHaveBeenCalledWith({ link: 'magnet:?xt=urn:btih:' + HASH, title: expect.any(String), category: 'movie' });
    expect(toast.value).toBe('Добавлено на сервер');
  });

  it('«На ТВ» adds and launches on the TV', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    registerSource(feedSource({ movie: [row({})] }));
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    await mount();
    click(el.querySelector('[aria-label^="Добавить и смотреть на ТВ:"]'));
    await flush();
    expect(launch).toHaveBeenCalled();
    expect(launch.mock.calls[0][0].torrent).toBe(HASH);
  });

  it('a partial refresh keeps the rows of sites that did not answer; the line names the sites behind the rows', async () => {
    registerSource({ id: 'other', name: 'Другой', kind: 'builtin', search: () => Promise.resolve([]), latest: () => Promise.reject(new Error('нет')) });
    registerSource(feedSource({ movie: [row({ Title: 'Свежий', date: 9000 })] }));
    saveFeed('movie', [row({ Title: 'С другого', source: 'other', Hash: 'd'.repeat(40), date: 100 }), row({ Title: 'Старый ленточный', Hash: 'e'.repeat(40), date: 50 })], Date.now() - 3600000, ['other', 'feedy']);
    try {
      await mount();
      const titles = Array.from(el.querySelectorAll('.m-result-card')).map((n) => n.getAttribute('data-title'));
      expect(titles).toEqual(['Свежий', 'С другого']);
      expect(loadFeed('movie')!.sources).toEqual(['feedy', 'other']);
      expect(el.querySelector('.m-news-status')!.textContent).toContain('Свежее с Ленточный, Другой');
    } finally {
      unregisterSource('other');
    }
  });

  it('only the sites that answered are named', async () => {
    registerSource({ id: 'other', name: 'Другой', kind: 'builtin', search: () => Promise.resolve([]), latest: () => Promise.reject(new Error('нет')) });
    registerSource(feedSource({ movie: [row({})] }));
    try {
      await mount();
      expect(el.querySelector('.m-news-status')!.textContent).toContain('Свежее с Ленточный ·');
    } finally {
      unregisterSource('other');
    }
  });

  it('a refresh with no answer and no cache is not repeated within 10 minutes (unless «Обновить»)', async () => {
    let n = 0;
    registerSource({ ...feedSource({}), latest: () => (n++, Promise.reject(new Error('нет'))) });
    await mount();
    expect(n).toBe(1);
    expect(el.textContent).toContain('Сайты не ответили');
    act(() => render(null, el));
    await mount();
    expect(n).toBe(1);
    click(byText('Обновить'));
    await flush();
    expect(n).toBe(2);
  });

  it('no feed source switched on: says which sites give the feed', async () => {
    await mount();
    expect(el.querySelector('.m-hint-warn')!.textContent).toContain('rutor, nnmclub и torrent.by');
  });
});

describe('«Новое» · Подписки', () => {
  it('lists subscriptions with conditions and new counts; the tab says how many are new', async () => {
    const s = addSubscription({ query: 'Дюна 2160p', quality: '2160', sources: null, notify: true, minSeeds: 20 }, 2000)!;
    addSubscription({ query: 'Песчаный город', quality: '', sources: null, notify: true }, 1000);
    addFindings([
      { subId: s.id, key: 'k1', at: 2, result: row({ Title: 'Дюна 1' }) },
      { subId: s.id, key: 'k2', at: 3, result: row({ Title: 'Дюна 2' }) },
    ]);
    await mount({ seg: 'subs' });
    // the count is a pill (the long «Подписки · 2 новых» wrapped to two lines, QA B10), the full text is the label
    expect(el.querySelector('[role=tab][aria-selected=true]')!.textContent).toBe('Подписки2');
    expect(el.querySelector('[role=tab][aria-selected=true]')!.getAttribute('aria-label')).toBe('Подписки · 2 новых');
    const rows = Array.from(el.querySelectorAll('.m-sub-row'));
    expect(rows[0].textContent).toContain('Дюна 2160p');
    expect(rows[0].textContent).toContain('Все источники · 2160p · от 20 сидов');
    expect(rows[0].querySelector('.m-fresh')!.textContent).toBe('2 новых');
    expect(rows[1].querySelector('.m-fresh')).toBeNull();
    click(rows[0]);
    expect(currentRoute.value).toEqual({ name: 'subFindings', id: s.id });
  });

  it('a long press on a «Хочу» poster shares the catalog title and a tap still opens findings', async () => {
    const s = addSubscription({
      query: 'Институт 2026',
      quality: '',
      sources: null,
      notify: true,
      catalog: { kind: 'tv', id: 42, title: 'Институт', year: 2026, poster: 'https://img.test/p.jpg' },
    }, 3000)!;
    await mount({ seg: 'subs' });
    const row = el.querySelector('.m-sub-row') as HTMLButtonElement;
    expect(row.querySelector('.m-sub-poster')).toBeTruthy();
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    const sent: string[] = [];
    setShareSender(async (o) => {
      sent.push(o.text);
      return 'sheet';
    });
    act(() => (document.querySelector('[data-share="title"]') as HTMLButtonElement).click());
    expect(sent[0]).toContain('Институт');
    expect(sent[0]).toContain('https://omp-player.online/t/tv/42');
    expect(sent[0]).not.toMatch(/magnet:|xt=urn:btih/i);
    expect(currentRoute.value.name).not.toBe('subFindings');
    setShareSender(null);
    resetTo({ name: 'news', seg: 'subs' });
    await mount({ seg: 'subs' });
    click(el.querySelector('.m-sub-row')!);
    expect(currentRoute.value).toEqual({ name: 'subFindings', id: s.id });
  });

  it('shows a stored poster and a letter tile only when none exists', async () => {
    addSubscription({
      query: 'Дюна',
      quality: '',
      sources: null,
      notify: true,
      catalog: { kind: 'movie', id: 7, title: 'Дюна', year: 2021, poster: 'https://img.test/d.jpg' },
    }, 2);
    const empty = addSubscription({
      query: 'Пусто',
      quality: '',
      sources: null,
      notify: true,
      catalog: { kind: 'movie', id: 8, title: 'Пусто', year: 2020, poster: '' },
    }, 1)!;
    setSubscriptionPoster(empty.id, '');
    await mount({ seg: 'subs' });
    const imgs = el.querySelectorAll('img.m-sub-poster');
    expect(imgs.length).toBe(1);
    expect(imgs[0].getAttribute('src')).toBe('https://img.test/d.jpg');
    const ph = el.querySelector('.m-sub-ph');
    expect(ph).toBeTruthy();
    expect(ph!.textContent).toBeTruthy();
    // still waiting on a lookup: a blank slot, not letters
    addSubscription({ query: 'Жду', quality: '', sources: null, notify: true }, 3);
    await mount({ seg: 'subs' });
    const waiting = Array.from(el.querySelectorAll('.m-sub-row')).find((r) => (r.textContent || '').indexOf('Жду') >= 0)!;
    expect(waiting.querySelector('img.m-sub-poster')).toBeNull();
    expect(waiting.querySelector('.m-sub-ph')).toBeNull();
    expect(waiting.querySelector('.m-sub-poster')).toBeTruthy();
  });

  it('Delete asks, removes that subscription, and a refresh does not bring it back', async () => {
    const keep = addSubscription({ query: 'Оставить', quality: '', sources: null, notify: true }, 1)!;
    const gone = addSubscription({ query: 'Убрать', quality: '', sources: null, notify: true }, 2)!;
    await mount({ seg: 'subs' });
    mountConfirmHost();
    const button = el.querySelector('[data-sub-remove="' + gone.id + '"]') as HTMLButtonElement;
    expect(button.getAttribute('data-code')).toBe('P03.4');
    click(button);
    click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Удалить')!);
    expect(document.getElementById('m-confirm-msg')!.textContent).toBe('Удалить подписку «Убрать»?');
    await declineConfirm();
    expect(loadSubs().map((s) => s.id).sort()).toEqual([keep.id, gone.id].sort());
    click(el.querySelector('[data-sub-remove="' + gone.id + '"]')!);
    click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Удалить')!);
    await acceptConfirm();
    expect(loadSubs().map((s) => s.query)).toEqual(['Оставить']);
    reloadMonitor();
    await flush();
    expect(loadSubs().map((s) => s.query)).toEqual(['Оставить']);
    expect(el.textContent).not.toContain('Убрать');
  });

  it('a left swipe asks before delete and a short swipe leaves the subscription', async () => {
    const s = addSubscription({ query: 'Свайп', quality: '', sources: null, notify: true }, 1)!;
    await mount({ seg: 'subs' });
    mountConfirmHost();
    const card = el.querySelector('[data-sub-swipe="' + s.id + '"]')!;
    const touch = (type: string, x: number, y: number) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      const point = { clientX: x, clientY: y, identifier: 1 };
      Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [point] });
      Object.defineProperty(ev, 'changedTouches', { value: [point] });
      act(() => {
        card.dispatchEvent(ev);
      });
    };
    touch('touchstart', 180, 40);
    touch('touchmove', 180 - 30, 48);
    touch('touchend', 150, 48);
    expect(document.getElementById('m-confirm-msg')).toBeNull();
    expect(loadSubs().map((x) => x.id)).toEqual([s.id]);
    touch('touchstart', 200, 40);
    touch('touchmove', 200 - SUB_SWIPE_THRESHOLD - 10, 44);
    touch('touchend', 80, 44);
    expect(document.getElementById('m-confirm-msg')!.textContent).toBe('Удалить подписку «Свайп»?');
    await declineConfirm();
    expect(loadSubs().map((x) => x.id)).toEqual([s.id]);
    touch('touchstart', 200, 40);
    touch('touchmove', 200 - SUB_SWIPE_THRESHOLD - 10, 44);
    touch('touchend', 80, 44);
    await acceptConfirm();
    expect(loadSubs()).toEqual([]);
  });

  it('the subscription menu sits outside the swipe, so a sideways gesture does not delete', async () => {
    const s = addSubscription({ query: 'Меню', quality: '', sources: null, notify: true }, 1)!;
    await mount({ seg: 'subs' });
    mountConfirmHost();
    click(el.querySelector('[data-sub-remove="' + s.id + '"]')!);
    const sheet = el.querySelector('.m-sheet-host')!;
    const swipe = el.querySelector('[data-sub-swipe="' + s.id + '"]')!;
    expect(sheet).toBeTruthy();
    expect(swipe.contains(sheet)).toBe(false);
    const touch = (type: string, x: number, y: number) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      const point = { clientX: x, clientY: y, identifier: 1 };
      Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [point] });
      Object.defineProperty(ev, 'changedTouches', { value: [point] });
      act(() => sheet.dispatchEvent(ev));
    };
    touch('touchstart', 200, 40);
    touch('touchmove', 40, 44);
    touch('touchend', 40, 44);
    expect(document.getElementById('m-confirm-msg')).toBeNull();
    expect(loadSubs().map((x) => x.id)).toEqual([s.id]);
  });

  it('a poster looked up after the subscription was added stays on the row', async () => {
    installSubPosters(async () => ({ poster: 'https://img.test/found.jpg' }));
    addSubscription({ query: 'Дюна 2021', quality: '', sources: null, notify: true }, 1);
    await flush();
    await mount({ seg: 'subs' });
    expect(loadSubs()[0].poster).toBe('https://img.test/found.jpg');
    expect(el.querySelector('img.m-sub-poster')!.getAttribute('src')).toBe('https://img.test/found.jpg');
  });

  it('«+ Новая подписка» opens the sheet and creates one', async () => {
    await mount({ seg: 'subs' });
    click(byText('+ Новая подписка'));
    const input = el.querySelector('#m-sub-query') as HTMLInputElement;
    act(() => {
      input.value = 'Северный ветер';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(byText('Сохранить'));
    await flush();
    expect(el.querySelector('.m-sub-row')!.textContent).toContain('Северный ветер');
  });

  it('«Проверить сейчас» starts a check; the status line shows the last and the next check', async () => {
    // pin the clock to midday so «около завтра …» can't appear near midnight
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
    const now = Date.now();
    saveLastRun({ at: now - 60000, kind: 'check', found: 0, notified: 0, answered: 1, asked: 1, subs: 1, skipped: 0, feed: false });
    mon.status = { enabled: true, hours: 3, wifiOnly: true, running: false, nextRun: now + 3600000 };
    await mount({ seg: 'subs' });
    const line = el.querySelector('[data-monitor-status]')!.textContent!;
    expect(line).toMatch(/^Проверено в \d\d:\d\d · следующая проверка около \d\d:\d\d$/);
    click(el.querySelector('[data-check-now]'));
    await flush();
    expect(mon.runNow).toHaveBeenCalled();
    expect(el.querySelector('[data-monitor-status]')!.textContent).toBe('Проверяю…');
    // the background run ends
    mon.done(null);
    vi.useRealTimers();
  });

  it('new episodes: card with the ranges, «Не следить» switches the series off', async () => {
    torrents.value = [{ hash: OLD, title: 'Starbound Frontier / Сезон 2 / Серии 1-8 из 10 / 1080p', stat: 3 } as any];
    addFindings([episodesFinding()]);
    saveWatchMock.mockResolvedValue(false);
    await mount({ seg: 'subs' });
    const card = el.querySelector('.m-ep-card')!;
    expect(card.textContent).toContain('Starbound Frontier · Сезон 2');
    expect(card.textContent).toContain('Вышли серии 9-10 · у вас 1-8');
    // looked at
    expect(unseenCount('episodes')).toBe(0);
    click(byText('Не следить'));
    await flush();
    expect(saveWatchMock.mock.calls[0][1]).toEqual({ hash: OLD });
    expect(saveWatchMock.mock.calls[0][2]).toBe(false);
    expect(findingsOf('episodes')).toEqual([]);
    expect(el.querySelector('.m-ep-card')).toBeNull();
    expect(toast.value).toContain('Больше не слежу');
  });

  it('«Не следить» on a card whose torrent is gone from the server just removes the card', async () => {
    addFindings([episodesFinding()]);
    vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
    await mount({ seg: 'subs' });
    click(byText('Не следить'));
    await flush();
    expect(saveWatchMock).not.toHaveBeenCalled();
    expect(findingsOf('episodes')).toEqual([]);
    expect(el.querySelector('.m-ep-card')).toBeNull();
  });

  it('«Не следить» that fails keeps the card and says why', async () => {
    torrents.value = [{ hash: OLD, title: 'Starbound Frontier / Сезон 2 / Серии 1-8 из 10 / 1080p', stat: 3 } as any];
    addFindings([episodesFinding()]);
    saveWatchMock.mockRejectedValue(new Error('Сервер недоступен'));
    await mount({ seg: 'subs' });
    click(byText('Не следить'));
    await flush();
    expect(loadFound()).toHaveLength(1);
    expect(toast.value).toBe('Сервер недоступен');
  });

  it('a notification link highlights the card; «Смотреть на ТВ» replaces first, then plays the new torrent', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    torrents.value = [{ hash: OLD, title: 'Starbound Frontier / Сезон 2 / Серии 1-8 из 10 / 1080p', category: 'tv', stat: 3 } as any];
    addFindings([episodesFinding()]);
    const add = vi.spyOn(TorrServerClient.prototype, 'add');
    const NEW = 'f'.repeat(40);
    replaceMock.mockResolvedValue({ ok: true, hash: NEW });
    await mount({ seg: 'subs', finding: OLD + ':2:10', watch: true });
    expect(el.querySelector('.m-ep-card.m-hl')).toBeTruthy();
    expect(el.querySelector('.m-watch-prompt')).toBeTruthy();
    await flush();
    // nothing happens before the taps
    expect(replaceMock).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    click(byText('Смотреть на ТВ'));
    expect(el.querySelector('[role=dialog][aria-label="Заменить раздачу"]')!.textContent).toContain('Заменить и смотреть');
    expect(launch).not.toHaveBeenCalled();
    click(Array.from(el.querySelectorAll('.m-sheet button')).find((b) => b.textContent === 'Заменить и смотреть'));
    await flush();
    expect(replaceMock.mock.calls[0][1]).toBe(OLD);
    expect(replaceMock.mock.calls[0][2]).toMatchObject({ Title: 'Starbound Frontier / Сезон 2 / Серии 1-10 из 10 / 1080p' });
    expect(add).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0][0].torrent).toBe(NEW);
    expect(findingsOf('episodes')).toEqual([]);
  });

  it('«Смотреть на ТВ» after a failed replace shows the error and plays nothing', async () => {
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    torrents.value = [{ hash: OLD, title: 'Starbound Frontier / Сезон 2 / Серии 1-8 из 10 / 1080p', category: 'tv', stat: 3 } as any];
    addFindings([episodesFinding()]);
    replaceMock.mockResolvedValue({ ok: false, error: 'Сервер недоступен' });
    await mount({ seg: 'subs', finding: OLD + ':2:10', watch: true });
    click(byText('Смотреть на ТВ'));
    click(Array.from(el.querySelectorAll('.m-sheet button')).find((b) => b.textContent === 'Заменить и смотреть'));
    await flush();
    expect(el.querySelector('.m-sheet [role=alert]')!.textContent).toBe('Сервер недоступен');
    expect(launch).not.toHaveBeenCalled();
    expect(findingsOf('episodes')).toHaveLength(1);
  });

  it('the episode buttons name their series', async () => {
    addFindings([episodesFinding()]);
    await mount({ seg: 'subs' });
    expect(el.querySelector('[aria-label="Заменить раздачу: Starbound Frontier"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Не следить за новыми сериями: Starbound Frontier"]')).toBeTruthy();
  });

  it('«Проверяю…» ends on monitorDone, not on other store changes, and after the time limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      await mount({ seg: 'subs' });
      click(el.querySelector('[data-check-now]'));
      await flush();
      expect(el.querySelector('[data-monitor-status]')!.textContent).toBe('Проверяю…');
      act(() => reloadMonitor());
      await flush();
      expect(el.querySelector('[data-monitor-status]')!.textContent).toBe('Проверяю…');
      // the end of a notification-button run does not end the check
      act(() => monitorFinished({ at: 1, kind: 'action' } as any));
      await flush();
      expect(el.querySelector('[data-monitor-status]')!.textContent).toBe('Проверяю…');
      act(() => monitorFinished({ at: 2, kind: 'check' } as any));
      await flush();
      expect(el.querySelector('[data-monitor-status]')!.textContent).not.toBe('Проверяю…');
      click(el.querySelector('[data-check-now]'));
      await flush();
      expect(el.querySelector('[data-monitor-status]')!.textContent).toBe('Проверяю…');
      act(() => {
        vi.advanceTimersByTime(RUN_MAX_MS + 1);
      });
      await flush();
      expect(el.querySelector('[data-monitor-status]')!.textContent).not.toBe('Проверяю…');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the first visit asks for the notification permission once', async () => {
    await mount({ seg: 'subs' });
    expect(mon.requestNotifyPermission).toHaveBeenCalledTimes(1);
    act(() => render(null, el));
    mon.permission = 'prompt';
    await mount({ seg: 'subs' });
    expect(mon.requestNotifyPermission).toHaveBeenCalledTimes(1);
  });

  it('«Заменить…» opens the replace sheet', async () => {
    addFindings([episodesFinding()]);
    await mount({ seg: 'subs' });
    click(byText('Заменить…'));
    expect(el.querySelector('[role=dialog][aria-label="Заменить раздачу"]')).toBeTruthy();
  });
});

describe('«Новое» · Настройки мониторинга', () => {
  it('a header gear and a row button at the bottom both open the monitoring settings', async () => {
    await mount({ seg: 'subs' });
    const gear = el.querySelector('[data-monitor-gear]')!;
    expect(gear.getAttribute('aria-label')).toBe('Настройки мониторинга');
    expect(gear.classList.contains('m-head-btn')).toBe(true);
    const rowBtn = el.querySelector('[data-monitor-row]')!;
    expect(rowBtn.textContent).toContain('Настройки мониторинга');
    click(gear);
    expect(currentRoute.value).toEqual({ name: 'monitor' });
    resetTo({ name: 'news' });
    click(rowBtn);
    expect(currentRoute.value).toEqual({ name: 'monitor' });
  });

  it('the gear is there on the feed too', async () => {
    await mount();
    expect(el.querySelector('[data-monitor-gear]')).toBeTruthy();
  });

  it('one compact header: the title, then round icon buttons; «Проверить сейчас» is a refresh button that spins while checking', async () => {
    await mount();
    const head = el.querySelector('.m-screen-head')!;
    expect(head.querySelector('h1')!.textContent).toBe('Новое');
    // the feed: TV and the monitoring settings
    expect(Array.from(head.querySelectorAll('button')).map((b) => b.className)).toEqual(['m-tvchip', 'm-tvchip m-head-btn']);
    // the monitoring icon is not the sliders of the «Настройки» tab
    expect(head.querySelector('[data-monitor-gear] path')!.getAttribute('d')).not.toBe(
      'M4 7h10M18 7h2M4 17h4M12 17h8M14 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    );
    click(byText('Подписки'));
    const check = head.querySelector('[data-check-now]') as HTMLButtonElement;
    expect(check.classList.contains('m-head-btn')).toBe(true);
    expect(check.getAttribute('aria-label')).toBe('Проверить сейчас');
    expect(check.textContent).toBe('');
    expect(check.disabled).toBe(false);
    click(check);
    await flush();
    const busy = el.querySelector('[data-check-now]') as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.querySelector('svg')!.getAttribute('class')).toBe('m-spin');
    mon.done(null);
  });
});

describe('News in English', () => {
  const EN = (p: Partial<SourceResult>) => row({ Size: '18.2 GB', ...p });
  beforeEach(() => applyLanguageSetting('en'));
  afterEach(() => applyLanguageSetting('ru'));

  it('feed: tabs, chips, status line, refresh and the empty states', async () => {
    registerSource({
      id: 'feedy',
      name: 'Feedy',
      kind: 'builtin',
      search: () => Promise.resolve([]),
      latest: () => Promise.resolve([EN({ Title: 'Quiet Harbor (2026) WEB-DL 720p', date: 5000 })]),
    });
    await mount();
    expect(el.querySelector('h1')!.textContent).toBe('New');
    expect(Array.from(el.querySelectorAll('[role=tab]')).map((b) => b.textContent)).toEqual(['Feed', 'Subscriptions', 'Calendar']);
    expect(Array.from(el.querySelectorAll('.m-chips')[0].querySelectorAll('.m-chip')).map((b) => b.textContent)).toEqual(['Movies', 'Series', 'Anime', '1080p+']);
    expect(el.querySelector('.m-news-status .m-grow')!.textContent).toMatch(/^Latest from Feedy · updated at \d\d:\d\d$/);
    expect(byText('Refresh')).toBeTruthy();
    click(byText('1080p+'));
    expect(el.textContent).toContain('No 1080p or higher releases');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('feed: no sources switched on and sites that did not answer', async () => {
    await mount();
    expect(el.querySelector('.m-hint-warn')!.textContent).toContain('The feed comes from rutor, nnmclub and torrent.by - turn them on in “Search sources”.');
    expect(el.querySelector('.m-hint-warn')!.textContent).toContain('Got it');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
    registerSource({ id: 'feedy', name: 'Feedy', kind: 'builtin', search: () => Promise.resolve([]), latest: () => Promise.reject(new Error('down')) });
    click(byText('Series'));
    await flush();
    expect(el.querySelector('.m-news-status')!.textContent).toContain('sites did not respond');
    expect(el.textContent).toContain('Sites did not respond - try again later');
  });

  it('subscriptions: empty list, buttons and the monitoring link', async () => {
    await mount({ seg: 'subs' });
    expect(el.querySelector('[data-check-now]')!.getAttribute('aria-label')).toBe('Check now');
    expect(byText('+ New subscription')).toBeTruthy();
    expect(el.querySelector('[data-monitor-gear]')!.getAttribute('aria-label')).toBe('Monitoring settings');
    expect(el.querySelector('[data-monitor-row]')!.textContent).toContain('Monitoring settings');
    const text = el.textContent!;
    expect(text).toContain('Not checked yet');
    expect(text).toContain('No subscriptions yet. OMP will tell you when new releases appear for a query.');
    expect(text).toContain('New episodes of catalog series');
    expect(text).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('subscriptions: counts on the tab, the episodes card and its buttons', async () => {
    const s = addSubscription({ query: 'Dune 2160p', quality: '2160', sources: null, notify: true })!;
    addFindings([{ subId: s.id, key: 'k1', at: 2, result: EN({ Title: 'Dune 1' }) }]);
    torrents.value = [{ hash: OLD, title: 'Starbound Frontier / Season 2 / Episodes 1-8 of 10 / 1080p', stat: 3 } as any];
    addFindings([
      episodesFinding({
        result: EN({ Title: 'Starbound Frontier / Season 2 / Episodes 1-10 of 10 / 1080p' }),
        episodes: { torrentHash: OLD, torrentTitle: 'Starbound Frontier / Season 2 / Episodes 1-8 of 10 / 1080p', season: 2, haveTo: 8, from: 1, to: 10 },
      }),
    ]);
    await mount({ seg: 'subs' });
    expect(el.querySelector('[role=tab][aria-selected=true]')!.textContent).toBe('Subscriptions2');
    expect(el.querySelector('[role=tab][aria-selected=true]')!.getAttribute('aria-label')).toBe('Subscriptions · 2 new');
    const card = el.querySelector('.m-ep-card')!;
    expect(card.textContent).toContain('Starbound Frontier · Season 2');
    expect(card.textContent).toContain('Episodes 9-10 are out · you have 1-8');
    expect(byText('Replace…')).toBeTruthy();
    expect(byText('Stop following')).toBeTruthy();
    expect(el.querySelector('[aria-label="Replace the release: Starbound Frontier"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Stop following new episodes: Starbound Frontier"]')).toBeTruthy();
    expect(el.textContent).toContain('Catalog series are checked automatically; you can turn this off in the series card or here.');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('subscriptions: «Check now» toast and the watch prompt', async () => {
    mon.status = { enabled: true, hours: 3, wifiOnly: true, running: false };
    addFindings([episodesFinding({ result: EN({ Title: 'Starbound Frontier / Season 2 / Episodes 1-10 of 10 / 1080p' }), episodes: { torrentHash: OLD, torrentTitle: 'Starbound Frontier / Season 2 / Episodes 1-8 of 10 / 1080p', season: 2, haveTo: 8, from: 1, to: 10 } })]);
    await mount({ seg: 'subs', finding: OLD + ':2:10', watch: true });
    expect(el.querySelector('.m-watch-prompt')!.textContent).toContain('Watch on TV: Starbound Frontier?');
    expect(byText('Not now')).toBeTruthy();
    click(el.querySelector('[data-check-now]'));
    await flush();
    expect(toast.value).toBe('Checking subscriptions and series');
    expect(el.querySelector('[data-monitor-status]')!.textContent).toBe('Checking…');
    mon.done(null);
  });
});

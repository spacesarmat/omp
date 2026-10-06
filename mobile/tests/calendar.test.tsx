import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { Calendar } from '../src/screens/Calendar';
import {
  calendarEntries, calendarSeasons, calendarState, findingFor, followable, groupByDay, loadCalendar, pool, resetCalendar,
  type CalShow,
} from '../src/lib/calendar';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { resetSeriesMatches } from '../src/lib/seriesMatch';
import { currentRoute, resetTo } from '../src/nav';
import { torrents } from '../../src/store/library';
import { addFindings, addSubscription, loadSubs } from '../../src/monitor/subs';
import { EPISODES_ID, type Finding } from '../../src/monitor/types';
import { torrentQuery, type CatalogCard, type CatalogTitle, type SeasonDetails } from '../../src/catalog/tmdb';
import type { CatalogClient } from '../../src/catalog/client';
import type { Torrent } from '../../src/api/types';
import type { SourceResult } from '../../src/sources/types';

// «today» is Tuesday 6 October 2026, noon local time
const NOW = new Date(2026, 9, 6, 12).getTime();
const HASH = 'a'.repeat(40);

const FROST: CatalogCard = {
  kind: 'tv', id: 21, title: 'Ледяной перевал', original: 'Frost Pass', year: 2024, poster: 'https://img.test/p.jpg', rating: 8,
  backdrop: '', genres: [], runtime: 50, overview: '', cast: [], airing: true, status: 'returning', lastAirDate: '2026-10-04',
  seasons: [
    { number: 3, episodes: 8, year: 2026, aired: 4, airDate: '2026-09-13' },
    { number: 2, episodes: 8, year: 2025, aired: 8, airDate: '2025-03-01' },
  ],
  nextEpisode: { season: 3, episode: 5, airDate: '2026-10-08' },
};
const HARBOR: CatalogCard = {
  kind: 'tv', id: 31, title: 'Тихая гавань', original: 'Quiet Harbor', year: 2026, poster: '', rating: 0, backdrop: '',
  genres: [], runtime: 0, overview: '', cast: [], airing: true, status: 'production', lastAirDate: '',
  seasons: [{ number: 1, episodes: 8, year: 2026, aired: 0, airDate: '2026-10-06' }],
  nextEpisode: { season: 1, episode: 1, airDate: '2026-10-06' },
};
const OVER: CatalogCard = { ...FROST, id: 41, title: 'Закрытое дело', original: 'Closed Case', status: 'ended', nextEpisode: null };

const title = (c: CatalogCard): CatalogTitle => ({ kind: c.kind, id: c.id, title: c.title, original: c.original, year: c.year, poster: c.poster, rating: c.rating });
const FILM: CatalogTitle = { kind: 'movie', id: 51, title: 'Полуночный архив', original: 'Midnight Archive', year: 2026, poster: '', rating: 7 };

function season(n: number, dates: string[]): SeasonDetails {
  return { number: n, name: '', airDate: '', overview: '', episodes: dates.map((d, i) => ({ n: i + 1, title: 'Глава ' + (i + 1), airDate: d, runtime: 0, overview: '' })) };
}
const FROST_S3 = season(3, ['2026-09-13', '2026-09-20', '2026-10-01', '2026-10-04', '2026-10-08', '2026-10-15', '2026-11-20', '']);
const HARBOR_S1 = season(1, ['2026-10-06', '2026-10-13']);

function codeError(code: string): Error {
  const e = new Error('catalog:' + code);
  (e as Error & { code?: string }).code = code;
  return e;
}

let active = 0;
let peak = 0;
function track<T>(p: () => Promise<T>): Promise<T> {
  active++;
  peak = Math.max(peak, active);
  return Promise.resolve().then(p).then(
    (v) => {
      active--;
      return v;
    },
    (e) => {
      active--;
      throw e;
    },
  );
}

function fake(opts?: { fail?: string }) {
  const cards: { [id: number]: CatalogCard } = { 21: FROST, 31: HARBOR, 41: OVER };
  const c = {
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search: vi.fn((q: string) => track(() => {
      if (opts && opts.fail) return Promise.reject(codeError(opts.fail));
      if (/Ледян|Frost/i.test(q)) return Promise.resolve({ items: [title(FROST)], pages: 1 });
      if (/Тихая/i.test(q)) return Promise.resolve({ items: [title(HARBOR)], pages: 1 });
      if (/Закрыт/i.test(q)) return Promise.resolve({ items: [title(OVER)], pages: 1 });
      if (/Полуноч/i.test(q)) return Promise.resolve({ items: [FILM, title(FROST)], pages: 1 });
      return Promise.resolve({ items: [], pages: 0 });
    })),
    card: vi.fn((_k: string, id: number) => track(() => (cards[id] ? Promise.resolve(cards[id]) : Promise.reject(codeError('bad'))))),
    season: vi.fn((id: number, n: number) => track(() => {
      if (id === 21 && n === 3) return Promise.resolve(FROST_S3);
      if (id === 31 && n === 1) return Promise.resolve(HARBOR_S1);
      return Promise.reject(codeError('bad'));
    })),
  };
  setCatalogClientForTests(c as unknown as CatalogClient);
  return c;
}

const TOR: Torrent = { hash: HASH, title: 'Ледяной перевал / Frost Pass (2024) S03 1080p WEB-DL', category: 'tv', stat: 3, torrent_size: 1, timestamp: 1 } as Torrent;

function result(title: string): SourceResult {
  return { Title: title, Categories: '', Size: '2 ГБ', CreateDate: '', Tracker: '', Link: '', Magnet: 'magnet:?xt=urn:btih:' + 'c'.repeat(40), Hash: 'c'.repeat(40), Peer: 0, Seed: 10, source: 'feedy' };
}

const show = (card: CatalogCard, patch?: Partial<CalShow>): CalShow => ({ card, hashes: [], subIds: [], ...patch });

let el: HTMLElement;
function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}
async function flush() {
  for (let r = 0; r < 6; r++) {
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  }
}
const button = (text: string, root: ParentNode = el) =>
  Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  localStorage.clear();
  torrents.value = [];
  active = 0;
  peak = 0;
  resetCalendar();
  resetSeriesMatches();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetTo({ name: 'news', seg: 'calendar' });
});

afterEach(() => {
  if (el) act(() => render(null, el));
  setCatalogClientForTests(null);
  vi.useRealTimers();
});

describe('calendar data', () => {
  it('only returning or in-production shows are followed', () => {
    expect(followable(FROST)).toBe(true);
    expect(followable(HARBOR)).toBe(true);
    expect(followable(OVER)).toBe(false);
    expect(followable({ ...FROST, status: 'planned' })).toBe(false);
  });

  it('the seasons to read: the next episode one, the one on air when it aired lately, a premiere in the window', () => {
    expect(calendarSeasons(FROST, NOW)).toEqual([3]);
    expect(calendarSeasons({ ...FROST, nextEpisode: null }, NOW)).toEqual([3]);
    expect(calendarSeasons({ ...FROST, nextEpisode: null, lastAirDate: '2026-09-20' }, NOW)).toEqual([]);
    const premiere = { ...FROST, seasons: [{ number: 4, episodes: 8, year: 2026, aired: 0, airDate: '2026-10-25' }, ...FROST.seasons] };
    expect(calendarSeasons(premiere, NOW)).toEqual([3, 4]);
  });

  it('the entries of the window (3 days back, 30 ahead) with their status', () => {
    const e = calendarEntries(show(FROST), [FROST_S3], NOW);
    expect(e.map((x) => [x.episode, x.airDate, x.status])).toEqual([
      [4, '2026-10-04', 'aired'],
      [5, '2026-10-08', 'future'],
      [6, '2026-10-15', 'future'],
    ]);
    // no season data: the card's next episode alone
    expect(calendarEntries(show(FROST), [], NOW).map((x) => [x.season, x.episode, x.name, x.status])).toEqual([[3, 5, '', 'future']]);
    expect(calendarEntries(show(HARBOR), [HARBOR_S1], NOW).map((x) => [x.episode, x.status])).toEqual([[1, 'today'], [2, 'future']]);
  });

  it('grouped by day in order, headed «Сегодня», «Завтра», «Ср 8 окт.»; within a day by title', () => {
    const entries = calendarEntries(show(FROST), [FROST_S3], NOW).concat(calendarEntries(show(HARBOR), [HARBOR_S1], NOW));
    const twin = { ...calendarEntries(show({ ...HARBOR, id: 32, title: 'Альфа' }), [season(1, ['', '', '', '', '', '', '2026-10-08'])], NOW)[0] };
    const days = groupByDay(entries.concat([twin]), NOW);
    expect(days.map((d) => d.label)).toEqual(['Вс 4 окт.', 'Сегодня', 'Чт 8 окт.', 'Вт 13 окт.', 'Чт 15 окт.']);
    expect(days[2].entries.map((x) => x.show.card.title)).toEqual(['Альфа', 'Ледяной перевал']);
  });

  it('a finding has the episode: a new-episodes finding of the show torrents, or a subscription finding with that season and episode', () => {
    const [aired] = calendarEntries(show(FROST, { hashes: [HASH.toUpperCase()], subIds: ['s1'] }), [FROST_S3], NOW);
    const eps: Finding = {
      subId: EPISODES_ID, key: HASH + ':3:4', result: result('Ледяной перевал S03E03-04'), at: 5,
      episodes: { torrentHash: HASH, torrentTitle: TOR.title, season: 3, haveTo: 2, from: 3, to: 4 },
    };
    const sub: Finding = { subId: 's1', key: 'k1', result: result('Ледяной перевал / Frost Pass [S03E01-04] WEB-DL'), at: 9 };
    const otherSeason: Finding = { subId: 's1', key: 'k2', result: result('Ледяной перевал S02E04'), at: 10 };
    const otherSub: Finding = { subId: 's2', key: 'k3', result: result('Ледяной перевал S03E04'), at: 11 };
    expect(findingFor(aired, [eps])).toBe(eps);
    expect(findingFor(aired, [eps, sub, otherSeason, otherSub])).toBe(sub);
    expect(findingFor(aired, [otherSeason, otherSub])).toBeNull();
    const notCovered: Finding = { ...eps, episodes: { ...eps.episodes!, from: 5, to: 6 } };
    expect(findingFor(aired, [notCovered])).toBeNull();
  });

  it('pool runs at most `limit` at a time and ends after every task, failures included', async () => {
    let now = 0;
    let max = 0;
    const done: number[] = [];
    await pool([1, 2, 3, 4, 5], 2, (n) => {
      now++;
      max = Math.max(max, now);
      return Promise.resolve().then(() => {
        now--;
        done.push(n);
        if (n === 3) throw new Error('x');
      });
    });
    expect(max).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('gathering', () => {
  it('library series and series subscriptions, merged by show; films, ended shows and unknown queries left out; 2 at a time', async () => {
    const c = fake();
    torrents.value = [TOR];
    addSubscription({ query: 'Ледяной перевал', quality: '', sources: null, notify: true });
    addSubscription({ query: 'Тихая гавань', quality: '', sources: null, notify: true });
    addSubscription({ query: 'Полуночный архив 2026', quality: '', sources: null, notify: true });
    addSubscription({ query: 'Закрытое дело', quality: '', sources: null, notify: true });
    addSubscription({ query: 'Нет такого', quality: '', sources: null, notify: true });
    await loadCalendar(torrents.value, loadSubs(), false, NOW);
    const s = calendarState.value;
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.entries.map((e) => e.show.card.id + ':' + e.episode)).toEqual(['21:4', '21:5', '21:6', '31:1', '31:2']);
    const frost = s.entries[0].show;
    expect(frost.hashes).toEqual([HASH]);
    expect(frost.subIds).toEqual([loadSubs()[0].id]);
    // the film subscription matched no show; the ended show's seasons were never read
    expect(c.card).not.toHaveBeenCalledWith('tv', 51);
    expect(c.season.mock.calls.map((x) => x[0] + ':' + x[1]).sort()).toEqual(['21:3', '31:1']);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('offline with nothing known: the catalog error', async () => {
    fake({ fail: 'offline' });
    torrents.value = [TOR];
    await loadCalendar(torrents.value, [], false, NOW);
    expect(calendarState.value.error).toBe('offline');
    expect(calendarState.value.entries).toEqual([]);
  });
});

describe('the «Календарь» tab', () => {
  it('rows by day: poster, title, «S03E05 · name», the chip; «Смотреть» opens the finding, «Найти» the season search', async () => {
    fake();
    torrents.value = [TOR];
    const sub = addSubscription({ query: 'Тихая гавань', quality: '', sources: null, notify: true })!;
    addFindings([{
      subId: EPISODES_ID, key: HASH + ':3:4', result: result('Ледяной перевал S03E04 1080p'), at: 5,
      episodes: { torrentHash: HASH, torrentTitle: TOR.title, season: 3, haveTo: 3, from: 4, to: 4 },
    }]);
    mount(<Calendar />);
    await flush();
    const days = Array.from(el.querySelectorAll('.m-cal-day'));
    expect(days.map((d) => d.querySelector('.m-set-label')!.textContent)).toEqual(['Вс 4 окт.', 'Сегодня', 'Чт 8 окт.', 'Вт 13 окт.', 'Чт 15 окт.']);
    const first = days[0].querySelector('.m-cal-row')!;
    expect(first.querySelector('.m-cal-title')!.textContent).toBe('Ледяной перевал');
    expect(first.querySelector('.m-cal-ep')!.textContent).toBe('S03E04 · Глава 4');
    expect(first.querySelector('img')!.getAttribute('src')).toBe(FROST.poster);
    expect(first.querySelector('.m-cal-chip')!.textContent).toBe('вышла');
    const today = days[1].querySelector('.m-cal-row')!;
    expect(today.querySelector('.m-cal-chip')!.textContent).toBe('сегодня');
    const future = days[2].querySelector('.m-cal-row')!;
    expect(future.querySelector('.m-cal-chip')!.textContent).toBe('8 окт.');
    expect(future.querySelector('button.m-btn')).toBeNull();

    act(() => button('Смотреть', first)!.click());
    expect(currentRoute.value).toEqual({ name: 'news', seg: 'subs', finding: HASH + ':3:4' });
    act(() => button('Найти', today)!.click());
    expect(currentRoute.value).toEqual({ name: 'add', query: torrentQuery(HARBOR, 1), run: true });
    expect(sub.id).toBeTruthy();
  });

  it('a subscription finding opens in its subscription', async () => {
    fake();
    const sub = addSubscription({ query: 'Тихая гавань', quality: '', sources: null, notify: true })!;
    addFindings([{ subId: sub.id, key: 'r1', result: result('Тихая гавань / Quiet Harbor S01E01 WEB-DL'), at: 7 }]);
    mount(<Calendar />);
    await flush();
    act(() => button('Смотреть')!.click());
    expect(currentRoute.value).toEqual({ name: 'subFindings', id: sub.id, finding: 'r1' });
  });

  it('the empty state, and the gathered calendar is kept for the next visit', async () => {
    const c = fake();
    mount(<Calendar />);
    await flush();
    expect(el.textContent).toContain('В ближайшие 30 дней новых серий нет');
    expect(el.textContent).toContain('из сериалов в «Моих»');
    act(() => render(null, el));
    mount(<Calendar />);
    await flush();
    expect(c.search).not.toHaveBeenCalled();
    expect(calendarState.value.at).toBe(NOW);
  });

  it('no TMDB key: the catalog error with «Повторить»', async () => {
    fake({ fail: 'nokey' });
    torrents.value = [TOR];
    mount(<Calendar />);
    await flush();
    expect(el.querySelector('.m-disc-error')).not.toBeNull();
    expect(el.textContent).toContain('Нет ключа TMDB');
    expect(button('Повторить')).toBeTruthy();
  });

  it('English', async () => {
    applyLanguageSetting('en');
    fake();
    torrents.value = [TOR];
    mount(<Calendar />);
    await flush();
    const labels = Array.from(el.querySelectorAll('.m-cal-day .m-set-label')).map((x) => x.textContent);
    expect(labels).toEqual(['Sun, Oct 4', 'Thu, Oct 8', 'Thu, Oct 15']);
    expect(el.querySelector('.m-cal-chip')!.textContent).toBe('out');
    expect(button('Find')).toBeTruthy();
  });
});

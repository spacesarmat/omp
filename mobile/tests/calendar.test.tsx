import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { Calendar } from '../src/screens/Calendar';
import {
  calendarEntries, calendarSeasons, calendarState, dayCountLabel, dayRows, defaultMonthDay, episodeActions, episodesCode, findingFor, followable, groupByDay,
  ensureCalendarSpan, entriesForMonth, listGroups, loadCalendar, loadCalView, monthCells, monthSwipe, monthTitle, pool,
  realEpisodeName, resetCalendar, rowFinding, rowLine, seasonsInRange,
  saveCalView, subscribedOnly, type CalEntry, type CalShow,
} from '../src/lib/calendar';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import { currentRoute, resetTo } from '../src/nav';
import { torrents } from '../../src/store/library';
import { addFindings, addSubscription, loadSubs } from '../../src/monitor/subs';
import { EPISODES_ID, type Finding } from '../../src/monitor/types';
import { episodeTorrentQuery, torrentQuery, type CatalogCard, type CatalogTitle, type SeasonDetails } from '../../src/catalog/tmdb';
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

  it('placeholder episode names («Эпизод 7», «Episode 7», «Серия 7») are no names', () => {
    ['Эпизод 7', 'эпизод 12', 'Episode 7', 'EPISODE 3', 'Серия 7', 'Серия7', ' Episode 10 '].forEach((n) => expect(realEpisodeName(n)).toBe(''));
    ['Глава 4', 'Episode 7: Return', 'Пилот', 'Серия 7 и 8'].forEach((n) => expect(realEpisodeName(n)).toBe(n));
  });

  it('episode codes: one, consecutive, apart, both', () => {
    expect(episodesCode(13, [7])).toBe('S13E07');
    expect(episodesCode(13, [8, 7])).toBe('S13E07-E08');
    expect(episodesCode(13, [7, 8, 9])).toBe('S13E07-E09');
    expect(episodesCode(13, [7, 9])).toBe('S13E07, E09');
    expect(episodesCode(2, [1, 2, 4])).toBe('S02E01-E02, E04');
  });

  it('the episodes of a day of one show and season make one row; the name only for a lone episode with a real one', () => {
    const named = (n: number, name: string, card: CatalogCard = FROST, s = 13): CalEntry =>
      ({ show: show(card), season: s, episode: n, name: name, airDate: '2026-10-08', status: 'future' });
    const rows = dayRows([named(7, 'Эпизод 7'), named(8, 'Возвращение'), named(1, 'Начало', HARBOR, 1), named(9, 'Серия 9')]);
    expect(rows.map(rowLine)).toEqual(['S13E07-E09', 'S01E01 · Начало']);
    expect(rowLine(dayRows([named(7, 'Эпизод 7')])[0])).toBe('S13E07');
    expect(rowLine(dayRows([named(7, 'Episode 7')])[0])).toBe('S13E07');
    expect(rowLine(dayRows([named(7, 'Возвращение')])[0])).toBe('S13E07 · Возвращение');
    expect(rowLine(dayRows([named(7, ''), named(9, '')])[0])).toBe('S13E07, E09');
    // another season of the same show stays its own row
    expect(dayRows([named(7, ''), named(1, '', FROST, 14)]).length).toBe(2);
  });

  it('a merged row finds the finding of any of its episodes', () => {
    const s = show(FROST, { hashes: [HASH], subIds: [] });
    const e = (n: number): CalEntry => ({ show: s, season: 3, episode: n, name: '', airDate: '2026-10-04', status: 'aired' });
    const f: Finding = {
      subId: EPISODES_ID, key: HASH + ':3:5', result: result('Ледяной перевал S03E05'), at: 5,
      episodes: { torrentHash: HASH, torrentTitle: TOR.title, season: 3, haveTo: 4, from: 5, to: 5 },
    };
    expect(rowFinding(dayRows([e(4), e(5)])[0], [f])).toBe(f);
    expect(rowFinding(dayRows([e(4)])[0], [f])).toBeNull();
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

  it('episodes loaded for the list are already visible in that month', async () => {
    const c = fake();
    torrents.value = [TOR];
    await loadCalendar(torrents.value, [], false, NOW);
    expect(entriesForMonth(2026, 9).some((e) => e.airDate === '2026-10-08')).toBe(true);
    await ensureCalendarSpan('2026-10-01', '2026-10-31', NOW);
    expect(entriesForMonth(2026, 9).some((e) => e.airDate === '2026-10-08')).toBe(true);
    const settled = c.season.mock.calls.length;
    await ensureCalendarSpan('2026-10-01', '2026-10-31', NOW);
    expect(c.season.mock.calls.length).toBe(settled);
  });

  it('a recent season with no air date stays in the list and in that month', async () => {
    const c = fake();
    const undated: CatalogCard = {
      ...FROST,
      nextEpisode: null,
      seasons: [
        { number: 3, episodes: 8, year: 2026, aired: 4, airDate: '' },
        { number: 2, episodes: 8, year: 2025, aired: 8, airDate: '2025-03-01' },
      ],
    };
    c.card.mockImplementation(() => Promise.resolve(undated));
    c.season.mockImplementation((id: number, n: number) => {
      if (id === 21 && n === 3) return Promise.resolve(FROST_S3);
      if (id === 21) return Promise.resolve(season(n, []));
      return Promise.reject(codeError('bad'));
    });
    torrents.value = [TOR];
    await loadCalendar(torrents.value, [], false, NOW);
    expect(calendarState.value.entries.map((e) => e.airDate)).toContain('2026-10-04');
    expect(entriesForMonth(2026, 9).some((e) => e.airDate === '2026-10-04')).toBe(true);
    await ensureCalendarSpan('2026-10-01', '2026-10-31', NOW);
    expect(entriesForMonth(2026, 9).some((e) => e.airDate === '2026-10-04')).toBe(true);
    const settled = c.season.mock.calls.length;
    await ensureCalendarSpan('2026-10-01', '2026-10-31', NOW);
    expect(c.season.mock.calls.length).toBe(settled);
  });

  it('a failed show is asked again and does not hide a show that answered', async () => {
    const c = fake();
    const ok = c.season.getMockImplementation();
    torrents.value = [TOR];
    addSubscription({ query: 'Тихая гавань', quality: '', sources: null, notify: true });
    c.season.mockImplementation((id: number, n: number) => (id === 31 ? Promise.reject(codeError('offline')) : ok!(id, n)));
    await loadCalendar(torrents.value, loadSubs(), false, NOW);
    expect(entriesForMonth(2026, 9).some((e) => e.show.card.id === 21 && e.airDate === '2026-10-04')).toBe(true);
    // the failed show has only the card's next episode, not the rest of the season
    expect(entriesForMonth(2026, 9).some((e) => e.show.card.id === 31 && e.episode === 2)).toBe(false);
    const calls = c.season.mock.calls.length;
    c.season.mockImplementation(ok!);
    await ensureCalendarSpan('2026-10-01', '2026-10-31', NOW);
    expect(c.season.mock.calls.length).toBeGreaterThan(calls);
    expect(entriesForMonth(2026, 9).some((e) => e.show.card.id === 31 && e.episode === 2)).toBe(true);
    expect(entriesForMonth(2026, 9).some((e) => e.airDate === '2026-10-04')).toBe(true);
    expect(calendarState.value.entries.some((e) => e.show.card.id === 31 && e.episode === 2)).toBe(true);
  });

  it('a failed read is not treated as loaded, so the next visit asks again', async () => {
    const c = fake();
    const ok = c.season.getMockImplementation();
    torrents.value = [TOR];
    c.season.mockRejectedValue(codeError('offline'));
    await loadCalendar(torrents.value, [], false, NOW);
    expect(entriesForMonth(2026, 9).map((e) => e.airDate)).toEqual(['2026-10-08']);
    const afterFail = c.season.mock.calls.length;
    await ensureCalendarSpan('2026-10-01', '2026-10-31', NOW);
    expect(c.season.mock.calls.length).toBeGreaterThan(afterFail);
    expect(entriesForMonth(2026, 9).map((e) => e.airDate)).toEqual(['2026-10-08']);
    c.season.mockImplementation(ok!);
    await ensureCalendarSpan('2026-10-01', '2026-10-31', NOW);
    expect(entriesForMonth(2026, 9).some((e) => e.airDate === '2026-10-04')).toBe(true);
    expect(entriesForMonth(2026, 9).some((e) => e.airDate === '2026-10-08')).toBe(true);
    const settled = c.season.mock.calls.length;
    await ensureCalendarSpan('2026-10-01', '2026-10-31', NOW);
    expect(c.season.mock.calls.length).toBe(settled);
  });

  it('opening another month does not add its days to the list window', async () => {
    fake();
    torrents.value = [TOR];
    await loadCalendar(torrents.value, [], false, NOW);
    const list = calendarState.value.entries.map((e) => e.airDate);
    await ensureCalendarSpan('2026-11-01', '2026-11-30', NOW);
    expect(entriesForMonth(2026, 10).some((e) => e.airDate === '2026-11-20')).toBe(true);
    expect(calendarState.value.entries.map((e) => e.airDate)).toEqual(list);
    expect(list.indexOf('2026-11-20')).toBe(-1);
    await ensureCalendarSpan('2026-10-01', '2026-10-31', NOW);
    expect(entriesForMonth(2026, 9).some((e) => e.airDate === '2026-10-08')).toBe(true);
  });

  it('offline with nothing known: the catalog error', async () => {
    fake({ fail: 'offline' });
    torrents.value = [TOR];
    await loadCalendar(torrents.value, [], false, NOW);
    expect(calendarState.value.error).toBe('offline');
    expect(calendarState.value.entries).toEqual([]);
  });
});

describe('list and month', () => {
  const entries = () => calendarEntries(show(FROST), [FROST_S3], NOW).concat(calendarEntries(show(HARBOR), [HARBOR_S1], NOW));

  it('released first, then this week, next week and later; a date stays on the row', () => {
    const groups = listGroups(entries(), NOW);
    expect(groups.map((g) => g.id)).toEqual(['out', 'week', 'next']);
    expect(groups[0].rows.map((r) => r.show.card.title + ' ' + r.airDate)).toEqual(['Тихая гавань 2026-10-06', 'Ледяной перевал 2026-10-04']);
    expect(groups[1].rows.map((r) => r.airDate)).toEqual(['2026-10-08']);
    expect(groups[2].rows.map((r) => r.airDate)).toEqual(['2026-10-13', '2026-10-15']);
  });

  it('«Только мои подписки» keeps a show that has a subscription', () => {
    const all = entries();
    all[0].show = { ...all[0].show, subIds: ['s1'] };
    expect(subscribedOnly(all).every((e) => e.show.card.id === 21)).toBe(true);
  });

  it('the month grid highlights today, marks a day, and counts several as +N', () => {
    const twin = calendarEntries(show({ ...HARBOR, id: 32, title: 'Альфа', poster: 'https://img.test/a.jpg' }), [season(1, ['', '', '2026-10-08'])], NOW);
    const cells = monthCells(2026, 9, entries().concat(twin), NOW);
    const today = cells.filter((c) => c.iso === '2026-10-06')[0];
    const eighth = cells.filter((c) => c.iso === '2026-10-08')[0];
    expect(today.today).toBe(true);
    expect(today.inMonth).toBe(true);
    expect(eighth.count).toBe(2);
    expect(dayCountLabel(eighth.count)).toBe('+2');
    expect(dayCountLabel(1)).toBe('');
    expect(eighth.poster).toBe(FROST.poster);
    expect(monthTitle(2026, 9)).toBe('Октябрь 2026');
    expect(defaultMonthDay(2026, 9, entries(), NOW)).toBe('2026-10-06');
    expect(defaultMonthDay(2026, 10, entries(), NOW)).toBe('');
    expect(monthSwipe(-80, 10)).toBe(1);
    expect(monthSwipe(80, 10)).toBe(-1);
    expect(monthSwipe(10, 40)).toBe(0);
  });

  it('a month outside the 30 day window still has its episodes', () => {
    expect(seasonsInRange(FROST, '2026-11-01', '2026-11-30')).toEqual([3]);
    expect(seasonsInRange(FROST, '2026-09-01', '2026-09-30')).toContain(3);
    const nov = calendarEntries(show(FROST), [FROST_S3], NOW, { from: '2026-11-01', to: '2026-11-30' });
    expect(nov.map((x) => [x.episode, x.airDate])).toEqual([[7, '2026-11-20']]);
    expect(calendarEntries(show(FROST), [FROST_S3], NOW).some((x) => x.airDate === '2026-11-20')).toBe(false);
    const sep = calendarEntries(show(FROST), [FROST_S3], NOW, { from: '2026-09-01', to: '2026-09-30' });
    expect(sep.map((x) => x.airDate)).toEqual(['2026-09-13', '2026-09-20']);
  });

  it('the chosen view is remembered', () => {
    expect(loadCalView()).toBe('list');
    saveCalView('month');
    expect(loadCalView()).toBe('month');
  });
});

describe('the «Календарь» tab', () => {
  it('list rows: poster, title, episode, date, «вышла» / «сегодня»; «Смотреть» opens the finding, «Найти» the season search', async () => {
    fake();
    torrents.value = [TOR];
    const sub = addSubscription({ query: 'Тихая гавань', quality: '', sources: null, notify: true })!;
    addFindings([{
      subId: EPISODES_ID, key: HASH + ':3:4', result: result('Ледяной перевал S03E04 1080p'), at: 5,
      episodes: { torrentHash: HASH, torrentTitle: TOR.title, season: 3, haveTo: 3, from: 4, to: 4 },
    }]);
    mount(<Calendar />);
    await flush();
    const groups = Array.from(el.querySelectorAll('.m-cal-group'));
    expect(groups.map((d) => d.querySelector('.m-set-label')!.textContent)).toEqual(['Вышли', 'Эта неделя', 'Следующая']);
    const released = Array.from(groups[0].querySelectorAll('.m-cal-row'));
    const today = released[0];
    const first = released[1];
    expect(today.querySelector('.m-cal-title')!.textContent).toBe('Тихая гавань');
    expect(today.querySelector('.m-cal-chip')!.textContent).toBe('сегодня');
    expect(today.querySelector('.m-cal-when')!.textContent).toBe('Сегодня');
    expect(first.querySelector('.m-cal-title')!.textContent).toBe('Ледяной перевал');
    expect(first.querySelector('.m-cal-ep')!.textContent).toBe('S03E04 · Глава 4');
    expect(first.querySelector('.m-cal-when')!.textContent).toBe('Вс 4 окт.');
    expect(first.querySelector('img')!.getAttribute('src')).toBe(FROST.poster);
    expect(first.querySelector('.m-cal-chip')!.textContent).toBe('вышла');
    const future = groups[1].querySelector('.m-cal-row')!;
    expect(future.querySelector('.m-cal-chip')).toBeNull();
    expect(future.querySelector('.m-cal-side')).toBeNull();
    expect(future.querySelector('button.m-btn')).toBeNull();
    expect(future.querySelector('.m-cal-when')!.textContent).toBe('Чт 8 окт.');

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
    const labels = Array.from(el.querySelectorAll('.m-cal-group .m-set-label')).map((x) => x.textContent);
    expect(labels).toEqual(['Out', 'This week', 'Next week']);
    expect(el.querySelector('.m-cal-when')!.textContent).toBe('Sun, Oct 4');
    expect(el.querySelector('.m-cal-chip')!.textContent).toBe('out');
    expect(button('Find')).toBeTruthy();
  });

  it('month grid: today is selected, a day opens its rows, arrows change the month, the view is kept', async () => {
    fake();
    torrents.value = [TOR];
    addSubscription({ query: 'Тихая гавань', quality: '', sources: null, notify: true });
    mount(<Calendar />);
    await flush();
    act(() => button('Месяц')!.click());
    await flush();
    expect(el.querySelector('.m-cal-month-name')!.textContent).toBe('Октябрь 2026');
    const today = el.querySelector('[data-cal-cell="2026-10-06"]') as HTMLButtonElement;
    expect(today.className).toContain('is-today');
    expect(today.className).toContain('is-on');
    expect(el.querySelector('[data-cal-picked="2026-10-06"] .m-cal-title')!.textContent).toBe('Тихая гавань');
    expect(el.querySelector('[data-cal-cell="2026-10-08"] .m-cal-dotimg, [data-cal-cell="2026-10-08"] .m-cal-dot')).toBeTruthy();
    act(() => (el.querySelector('[data-cal-cell="2026-10-04"]') as HTMLButtonElement).click());
    expect(el.querySelector('[data-cal-picked="2026-10-04"] .m-cal-title')!.textContent).toBe('Ледяной перевал');
    act(() => (el.querySelector('[data-code="P03.13"]') as HTMLButtonElement).click());
    await flush();
    expect(el.querySelector('.m-cal-month-name')!.textContent).toBe('Ноябрь 2026');
    expect(el.querySelector('[data-cal-cell="2026-11-20"] .m-cal-dotimg, [data-cal-cell="2026-11-20"] .m-cal-dot')).toBeTruthy();
    expect(calendarState.value.entries.some((e) => e.airDate === '2026-11-20')).toBe(false);
    act(() => (el.querySelector('[data-code="P03.12"]') as HTMLButtonElement).click());
    expect(el.querySelector('.m-cal-month-name')!.textContent).toBe('Октябрь 2026');
    expect(el.querySelector('[data-cal-cell="2026-10-06"] .m-cal-dotimg, [data-cal-cell="2026-10-06"] .m-cal-dot')).toBeTruthy();
    act(() => (el.querySelector('[data-code="P03.13"]') as HTMLButtonElement).click());
    expect(el.querySelector('.m-cal-month-name')!.textContent).toBe('Ноябрь 2026');
    expect(el.querySelector('[data-cal-cell="2026-11-20"] .m-cal-dotimg, [data-cal-cell="2026-11-20"] .m-cal-dot')).toBeTruthy();
    expect(loadCalView()).toBe('month');
    act(() => render(null, el));
    mount(<Calendar />);
    await flush();
    expect(el.querySelector('.m-cal-grid')).toBeTruthy();
  });

  it('«Только мои подписки» hides a series that is only in the library', async () => {
    fake();
    torrents.value = [TOR];
    addSubscription({ query: 'Тихая гавань', quality: '', sources: null, notify: true });
    mount(<Calendar />);
    await flush();
    act(() => button('Только мои подписки')!.click());
    const titles = Array.from(el.querySelectorAll('.m-cal-title')).map((n) => n.textContent);
    expect(titles).toContain('Тихая гавань');
    expect(titles).not.toContain('Ледяной перевал');
  });

  it('tapping a row asks first: the season card when the show is in the catalog, cancel stays here', async () => {
    fake();
    torrents.value = [TOR];
    mount(<Calendar />);
    await flush();
    const row = el.querySelector('[data-cal-row="21:3:4"] button.m-cal-open') as HTMLButtonElement;
    act(() => row.click());
    expect(currentRoute.value).toEqual({ name: 'news', seg: 'calendar' });
    const sheet = el.querySelector('[data-cal-ask]')!;
    expect(sheet.querySelector('img')!.getAttribute('src')).toBe(FROST.poster);
    expect(sheet.querySelector('.m-cal-title')!.textContent).toBe('Ледяной перевал');
    expect(sheet.textContent).toContain('S03E04');
    expect(button('Открыть в каталоге', sheet)!.getAttribute('data-code')).toBe('P03.15');
    expect(button('Найти новую серию', sheet)).toBeUndefined();
    act(() => button('Отмена', sheet)!.click());
    expect(el.querySelector('[data-cal-ask]')).toBeNull();
    expect(currentRoute.value).toEqual({ name: 'news', seg: 'calendar' });
    act(() => row.click());
    act(() => button('Открыть в каталоге')!.click());
    expect(currentRoute.value).toEqual({ name: 'seasonCard', id: 21, season: 3 });
  });

  it('a month day row asks the same way', async () => {
    fake();
    torrents.value = [TOR];
    addSubscription({ query: 'Ледяной перевал', quality: '', sources: null, notify: true });
    mount(<Calendar />);
    await flush();
    act(() => button('Месяц')!.click());
    await flush();
    act(() => (el.querySelector('[data-cal-cell="2026-10-04"]') as HTMLButtonElement).click());
    act(() => (el.querySelector('[data-cal-picked="2026-10-04"] button.m-cal-open') as HTMLButtonElement).click());
    const sheet = el.querySelector('[data-cal-ask]')!;
    expect(button('Открыть в каталоге', sheet)).toBeTruthy();
    expect(button('Найти новую серию', sheet)!.getAttribute('data-code')).toBe('P03.17');
    act(() => button('Найти новую серию', sheet)!.click());
    expect(currentRoute.value).toEqual({ name: 'add', query: episodeTorrentQuery(FROST, 3, 4), run: true });
  });
});

describe('episode routing', () => {
  it('catalog opens that season; no catalog searches the season; a subscription adds the episode search', () => {
    const followed = episodeActions({ show: show(FROST, { subIds: ['s1'] }), season: 11, episode: 7 });
    expect(followed).toEqual({
      inCatalog: true,
      subscribed: true,
      primary: { name: 'seasonCard', id: 21, season: 11 },
      episode: { name: 'add', query: 'Ледяной перевал 11 сезон 7 серия', run: true },
    });
    const library = episodeActions({ show: show(FROST), season: 3, episode: 4 });
    expect(library.primary).toEqual({ name: 'seasonCard', id: 21, season: 3 });
    expect(library.episode).toBeNull();
    const missing = episodeActions({
      show: show({ ...FROST, id: 0, title: 'Американская история ужасов' }, { subIds: ['s1'] }),
      season: 11,
      episode: 2,
    });
    expect(missing.inCatalog).toBe(false);
    expect(missing.subscribed).toBe(false);
    expect(missing.episode).toBeNull();
    expect(missing.primary).toEqual({ name: 'add', query: 'Американская история ужасов 11 сезон', run: true });
  });
});

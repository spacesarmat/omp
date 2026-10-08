import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/store/progress', async (orig) => ({
  ...(await orig<typeof import('../../src/store/progress')>()),
  markWatched: vi.fn(),
}));

import { SeriesScreen } from '../../src/screens/Series';
import { DialogHost } from '../../src/ui/dialog';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents, resetLibrary } from '../../src/store/library';
import { currentRoute, routeStack } from '../../src/ui/nav';
import { dispatchKey } from '../../src/ui/keys';
import { markWatched, saveProgress } from '../../src/store/progress';
import { mockFetch } from '../helpers/fetchMock';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import { resetEpisodeNames } from '../../src/lib/episodeNames';
import { seriesKey } from '../../src/lib/seriesGroups';
import { savePhoneLink, forgetPhoneLink } from '../../src/phone/phoneStore';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';

const files = (n: number) =>
  [1, 2].map((e) => ({ id: e, path: 'Dark.Matter.S0' + n + 'E0' + e + '.1080p.mkv', length: 2e9 }));
const season = (n: number) => ({
  hash: 's' + n,
  title: 'Тёмная материя / Dark Matter / Сезон: ' + n + ' / Серии: 1-2 из 9 (2024) WEB-DL 1080p',
  category: 'tv',
  timestamp: n,
  torrent_size: 4e9,
  file_stats: files(n),
});
const fixture = [
  season(1),
  season(2),
  { hash: 'f1', title: 'Quiet Signal (2024) 2160p', category: 'movie', timestamp: 9, file_stats: [{ id: 1, path: 'Quiet.Signal.2024.mkv', length: 1 }] },
];

const card = {
  id: 1,
  kind: 'tv',
  title: 'Тёмная материя',
  original: 'Dark Matter',
  year: 2024,
  poster: '',
  rating: 7.6,
  backdrop: 'http://img/backdrop.jpg',
  genres: ['фантастика'],
  runtime: 50,
  overview: 'Обзор сериала',
  cast: [],
  airing: true,
  status: 'returning',
  seasons: [
    { number: 1, episodes: 9, year: 2024, aired: 9, airDate: '2024-05-08' },
    { number: 2, episodes: 10, year: 2026, aired: 2, airDate: '2026-01-01' },
    { number: 3, episodes: 0, year: 2099, aired: 0, airDate: '2099-01-01' },
  ],
  // the pill reads «Выходит» only with a next episode: without one, the future season 3 makes it «Скоро новый сезон»
  nextEpisode: { season: 3, episode: 1, airDate: '2099-01-01' },
};
const stub: any = {
  search: () => Promise.resolve({ items: [{ id: 1, kind: 'tv', title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 7.6 }], pages: 1 }),
  card: () => Promise.resolve(card),
  season: (_id: number, n: number) =>
    Promise.resolve({
      number: n,
      name: '',
      airDate: '',
      overview: '',
      episodes: [
        { n: 1, title: 'Пилот', airDate: '2024-05-08', runtime: 50, overview: '' },
        { n: 2, title: 'Второй', airDate: '2024-05-15', runtime: 50, overview: '' },
      ],
    }),
};

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let key = '';
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  mockFetch((url) => ({ body: url.indexOf('/torrents') >= 0 ? JSON.stringify(fixture) : '[]' }));
  const a = addServer({ url: '10.0.0.2' });
  setActiveServer(a.id);
  resetLibrary();
  resetSeriesMatches();
  resetEpisodeNames();
  setCatalogProvider(() => Promise.resolve(stub));
  torrents.value = fixture as any;
  key = seriesKey(fixture[0] as any);
  routeStack.value = [{ name: 'library' }, { name: 'series', key }];
  (markWatched as any).mockClear();
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  stub.card = () => Promise.resolve(card);
  while (hosts.length) {
    const host = hosts.pop()!;
    act(() => { render(null, host); });
  }
  setCatalogProvider(null);
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(() => Promise.resolve());
};

async function mount(season?: number) {
  const host = document.createElement('div');
  hosts.push(host);
  document.body.appendChild(host);
  act(() => { render(h(SeriesScreen, { seriesKey: key, season }), host); });
  await flush();
  return host;
}

const text = (el: Element | null) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');

describe('TV series screen', () => {
  describe('«В ролях»', () => {
    const cast = [
      { id: 7, name: 'Джоэл Эдгертон', photo: '', role: 'Джейсон', job: 'cast' },
      { id: 8, name: 'Блейк Крауч', photo: '', role: '', job: 'creator' },
    ];
    it('is a row, OK on a person opens the person screen', async () => {
      stub.card = () => Promise.resolve({ ...card, cast });
      const host = await mount(2);
      expect(host.querySelector(".tc-cast-row")).not.toBeNull();
      expect(text(host.querySelector('.tc-h2'))).toBe('В ролях');
      expect(text(host.querySelector('[data-fk="series-cast-0"]'))).toContain('Блейк Крауч');
      act(() => { (host.querySelector('[data-fk="series-cast-1"]') as HTMLElement).click(); });
      expect(currentRoute.value).toEqual({ name: 'person', id: 7, label: 'Джоэл Эдгертон' });
    });
    it('sits right under the action buttons, before the seasons and episodes', async () => {
      stub.card = () => Promise.resolve({ ...card, cast });
      const host = await mount(2);
      const after = (a: string, b: string) => !!(host.querySelector(a)!.compareDocumentPosition(host.querySelector(b)!) & 4);
      expect(after('.series-hero', '.tc-cast-row')).toBe(true);
      expect(after('.tc-cast-row', '.series-episodes')).toBe(true);
    });
    it('is absent without a cast', async () => {
      stub.card = () => Promise.resolve(card);
      const host = await mount(2);
      expect(host.querySelector(".tc-cast-row")).toBeNull();
    });
  });

  describe('«Следить за сериями»', () => {
    afterEach(() => forgetPhoneLink());

    // a TorrServer that keeps the data of each torrent and records every «set»
    function server(data: { [hash: string]: string }) {
      const sets: { hash: string; data: string }[] = [];
      mockFetch((url, init) => {
        if (url.indexOf('/torrents') < 0) return { body: '[]' };
        const b = JSON.parse(init.body || '{}');
        if (b.action === 'set') {
          sets.push({ hash: b.hash, data: b.data });
          data[b.hash] = b.data;
          return { body: '{}' };
        }
        return { body: JSON.stringify(fixture.map((x) => ({ ...x, data: data[x.hash] || '' }))) };
      });
      return sets;
    }
    const press = async (host: HTMLElement) => {
      act(() => { (host.querySelector('[data-fk="series-follow"]') as HTMLElement).click(); });
      await flush();
    };

    it('is a switch, on by default, that writes omp.w for every torrent of the series', async () => {
      const sets = server({});
      const host = await mount(2);
      const btn = host.querySelector('[data-fk="series-follow"]') as HTMLElement;
      expect(text(btn)).toBe('Следить за сериями: вкл');
      expect(btn.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
      await press(host);
      expect(text(btn)).toBe('Следить за сериями: выкл');
      expect(sets.map((x) => x.hash).sort()).toEqual(['s1', 's2']);
      sets.forEach((x) => expect(JSON.parse(x.data).omp.w).toBe(false));
      await press(host);
      expect(text(btn)).toBe('Следить за сериями: вкл');
      expect(sets.length).toBe(4);
      sets.slice(2).forEach((x) => expect((JSON.parse(x.data).omp || {}).w).toBeUndefined());
    });

    it('shows the stored state and keeps the focus on the switch', async () => {
      server({ s1: JSON.stringify({ omp: { w: false } }), s2: JSON.stringify({ omp: { w: false } }) });
      const host = await mount(2);
      expect(text(host.querySelector('[data-fk="series-follow"]'))).toBe('Следить за сериями: выкл');
      act(() => setFocus('series-follow'));
      await press(host);
      expect(getCurrentFocusKey()).toBe('series-follow');
      expect(text(host.querySelector('[data-fk="series-follow"]'))).toBe('Следить за сериями: вкл');
    });

    it('the phone note shows only without a linked phone', async () => {
      server({});
      const host = await mount(2);
      expect(text(host.querySelector('.series-follow-note'))).toBe('Сообщать о новых сериях будет OMP на телефоне');
      savePhoneLink({ url: 'http://192.168.1.20:8097', token: 'f'.repeat(32), name: 'Phone' });
      await flush();
      expect(host.querySelector('.series-follow-note')).toBeNull();
    });
  });

  it('shows the TMDB title and the status pill', async () => {
    const host = await mount();
    expect(text(host.querySelector('.series-hero h1'))).toBe('Тёмная материя');
    expect(text(host.querySelector('.series-hero .series-pill'))).toContain('Выходит');
    expect(host.querySelector('.series-backdrop img')!.getAttribute('src')).toBe('http://img/backdrop.jpg');
  });

  it('has a chip per library season and a dashed chip for the season to come', async () => {
    const host = await mount();
    const chips = host.querySelectorAll('.season-chip');
    expect(chips).toHaveLength(3);
    expect(text(chips[0].querySelector('.chip-name'))).toBe('Сезон 1');
    expect(text(chips[1].querySelector('.chip-name'))).toBe('Сезон 2');
    expect(chips[2].classList.contains('chip-future')).toBe(true);
    expect(text(chips[2].querySelector('.chip-name'))).toBe('Сезон 3');
  });

  it('lists the chosen season with TMDB episode names', async () => {
    const host = await mount(2);
    const rows = host.querySelectorAll('.ep-row');
    expect(rows).toHaveLength(2);
    expect(text(rows[0].querySelector('.ep')) + ' ' + text(rows[0].querySelector('.name'))).toBe('S02E01 Пилот');
    expect(text(rows[1].querySelector('.ep')) + ' ' + text(rows[1].querySelector('.name'))).toBe('S02E02 Второй');
  });

  it('plays the next episode without a start position (the player asks where to start)', async () => {
    const host = await mount(2);
    act(() => setFocus('series-watch'));
    await flush();
    const btn = host.querySelector('[data-fk="series-watch"]')!;
    expect(text(btn)).toContain('S02E01');
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true } as KeyboardEventInit);
    Object.defineProperty(ev, 'keyCode', { get: () => 13 });
    Object.defineProperty(ev, 'which', { get: () => 13 });
    act(() => { window.dispatchEvent(ev); });
    const up = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true } as KeyboardEventInit);
    Object.defineProperty(up, 'keyCode', { get: () => 13 });
    Object.defineProperty(up, 'which', { get: () => 13 });
    act(() => { window.dispatchEvent(up); });
    await flush();
    const r = currentRoute.value as any;
    expect(r.name).toBe('player');
    expect(r.startAt).toBeUndefined();
    expect(r.queue[r.index].hash).toBe('s2');
    expect(r.queue[r.index].fileIndex).toBe(1);
  });

  it('opens the only torrent of the season from «Раздачи · 1»', async () => {
    const host = await mount(2);
    const btn = host.querySelector('[data-fk="series-releases"]') as HTMLElement;
    expect(text(btn)).toBe('Раздачи · 1');
    act(() => { btn.click(); });
    await flush();
    const r = currentRoute.value as any;
    expect(r.name).toBe('torrent');
    expect(r.hash).toBe('s2');
  });

  it('marks the focused episode watched on the red key', async () => {
    const host = await mount(2);
    const row = host.querySelectorAll('.ep-row')[1] as HTMLElement;
    act(() => setFocus(row.getAttribute('data-fk')!));
    await flush();
    act(() => { dispatchKey('red', new KeyboardEvent('keydown')); });
    await flush();
    expect(markWatched).toHaveBeenCalledWith('s2', 2);
  });

  it('shows one row per episode when two torrents hold the same season', async () => {
    const other = { ...season(2), hash: 's2b', timestamp: 5 };
    torrents.value = (fixture as any[]).concat(other) as any;
    // S02E01 watched in the older release: that copy stays; S02E02 comes from the newer one
    saveProgress('s2', 1, 100, 100);
    const host = await mount(2);
    const rows = host.querySelectorAll('.ep-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-fk')).toBe('ep-s2-1');
    expect(rows[1].getAttribute('data-fk')).toBe('ep-s2b-2');
    const chip = host.querySelector('[data-fk="season-2"]')!;
    expect(text(chip.querySelector('.chip-sub'))).toBe('2 из 10 серий · смотрели 1');
    const watch = host.querySelector('[data-fk="series-watch"]') as HTMLElement;
    expect(text(watch)).toContain('S02E02');
    act(() => { watch.click(); });
    await flush();
    const r = currentRoute.value as any;
    expect(r.name).toBe('player');
    expect(r.queue[r.index].hash).toBe('s2b');
    expect(r.queue[r.index].fileIndex).toBe(2);
  });

  it('keeps the chosen season when focus moves into the seasons row', async () => {
    const host = await mount(2);
    act(() => setFocus('series-watch'));
    await flush();
    act(() => setFocus('SERIES-SEASONS'));
    await flush();
    expect(host.querySelector('.season-chip.focused')!.getAttribute('data-fk')).toBe('season-2');
    expect(host.querySelector('.season-chip.on')!.getAttribute('data-fk')).toBe('season-2');
    expect(text(host.querySelector('.ep-row .ep'))).toBe('S02E01');
  });

  describe('every season of the TMDB card', () => {
    const allSeasons = card.seasons.concat({ number: 4, episodes: 0, year: 0, aired: 0 } as any);
    beforeEach(() => {
      // the library has season 2 only: season 1 is missing, 3 is dated later, 4 is announced without a date
      card.seasons = allSeasons;
      torrents.value = [fixture[1], fixture[2]] as any;
      key = seriesKey(fixture[1] as any);
      routeStack.value = [{ name: 'library' }, { name: 'series', key }];
    });
    afterEach(() => {
      card.seasons = allSeasons.slice(0, 3);
    });

    it('shows a missing chip, the library season and the seasons to come', async () => {
      const host = await mount();
      const chips = host.querySelectorAll('.season-chip');
      expect(Array.prototype.map.call(chips, (c: Element) => c.getAttribute('data-fk'))).toEqual(['season-1', 'season-2', 'season-3', 'season-4']);
      expect(chips[0].classList.contains('chip-missing')).toBe(true);
      expect(text(chips[0].querySelector('.chip-name'))).toBe('+ Сезон 1');
      expect(text(chips[0].querySelector('.chip-sub'))).toBe('нет в медиатеке');
      expect(chips[1].classList.contains('chip-future')).toBe(false);
      expect(chips[2].classList.contains('chip-future')).toBe(true);
      expect(text(chips[2].querySelector('.chip-sub'))).toContain('Сезон выйдет');
      expect(text(chips[3].querySelector('.chip-name'))).toBe('Сезон 4');
      expect(text(chips[3].querySelector('.chip-sub'))).toBe('скоро');
    });

    it('a missing season offers «Найти раздачи», which searches for that season', async () => {
      const host = await mount();
      act(() => setFocus('season-1'));
      await flush();
      expect(host.querySelectorAll('.ep-row')).toHaveLength(0);
      expect(text(host.querySelector('.series-missing .muted'))).toBe('Этого сезона нет в медиатеке');
      const btn = host.querySelector('[data-fk="series-find"]') as HTMLElement;
      expect(text(btn)).toBe('Найти раздачи');
      act(() => setFocus('series-find'));
      act(() => { btn.click(); });
      await flush();
      const r = currentRoute.value as any;
      expect(r.name).toBe('add');
      expect(r.query).toBe('Тёмная материя 1 сезон');
      expect(r.run).toBe(true);
      // Back returns to the season chip
      expect(getCurrentFocusKey()).toBe('season-1');
    });

    it('a season to come shows its date or «unknown» and no search button', async () => {
      const host = await mount();
      act(() => setFocus('season-3'));
      await flush();
      expect(host.querySelector('[data-fk="series-find"]')).toBeNull();
      expect(text(host.querySelector('.empty'))).toContain('Сезон выйдет');
      act(() => setFocus('season-4'));
      await flush();
      expect(host.querySelector('[data-fk="series-find"]')).toBeNull();
      expect(text(host.querySelector('.empty'))).toBe('Дата выхода пока неизвестна');
    });
  });

  describe('seasons row: numbering and runs', () => {
    const saved = card.seasons;
    const tmdb = (last: number) =>
      Array.apply(null, Array(last)).map((_x: unknown, i: number) => ({ number: i + 1, episodes: 10, year: 2010, aired: 10, airDate: '2010-01-01' }));
    const libSeason = (n: number) => ({
      ...season(2),
      hash: 'L' + n,
      title: 'Тёмная материя / Dark Matter / Сезон: ' + n + ' / Серии: 1-2 из 9 (2024) WEB-DL 1080p',
      file_stats: [1, 2].map((e) => ({ id: e, path: 'Dark.Matter.S' + (n < 10 ? '0' : '') + n + 'E0' + e + '.1080p.mkv', length: 2e9 })),
    });
    const useLibrary = (n: number) => {
      const tor = libSeason(n);
      torrents.value = [tor] as any;
      key = seriesKey(tor as any);
      routeStack.value = [{ name: 'library' }, { name: 'series', key }];
    };
    const fks = (host: HTMLElement) => Array.prototype.map.call(host.querySelectorAll('.season-chip'), (c: Element) => c.getAttribute('data-fk'));
    afterEach(() => {
      card.seasons = saved;
    });

    it('another numbering (library S14, TMDB 1–11) offers no missing seasons', async () => {
      card.seasons = tmdb(11) as any;
      useLibrary(14);
      const host = await mount();
      expect(fks(host)).toEqual(['season-14']);
      expect(host.querySelector('.chip-missing')).toBeNull();
    });

    it('a run of 4 or more missing seasons is one chip that searches its first season', async () => {
      card.seasons = tmdb(9) as any;
      useLibrary(9);
      const host = await mount();
      expect(fks(host)).toEqual(['season-1', 'season-9']);
      const chip = host.querySelector('[data-fk="season-1"]')!;
      expect(text(chip.querySelector('.chip-name'))).toBe('+ Сезоны 1–8');
      expect(text(chip.querySelector('.chip-sub'))).toBe('нет в медиатеке');
      act(() => setFocus('season-1'));
      await flush();
      expect(text(host.querySelector('.series-missing .muted'))).toBe('Этих сезонов нет в медиатеке');
      act(() => { (host.querySelector('[data-fk="series-find"]') as HTMLElement).click(); });
      await flush();
      expect((currentRoute.value as any).query).toBe('Тёмная материя 1 сезон');
    });

    it('a run of 2 missing seasons stays two chips', async () => {
      card.seasons = tmdb(3) as any;
      useLibrary(3);
      const host = await mount();
      expect(fks(host)).toEqual(['season-1', 'season-2', 'season-3']);
      expect(text(host.querySelector('[data-fk="season-2"] .chip-name'))).toBe('+ Сезон 2');
    });

    it('the row does not wrap and scrolls the focused chip into view', async () => {
      const css = readFileSync('src/styles.css', 'utf8');
      expect(/\.series-seasons \{[^}]*overflow: hidden/.test(css)).toBe(true);
      expect(/\.series-seasons-row \{[^}]*flex-wrap: nowrap[^}]*white-space: nowrap/.test(css)).toBe(true);
      expect(/\.series-seasons \{[^}]*flex-wrap: wrap/.test(css)).toBe(false);
      card.seasons = tmdb(9) as any;
      useLibrary(9);
      const host = await mount();
      const box = host.querySelector('.series-seasons') as HTMLElement;
      let left = 0;
      Object.defineProperty(box, 'scrollLeft', { get: () => left, set: (v: number) => { left = v; }, configurable: true });
      Object.defineProperty(box, 'clientWidth', { get: () => 600 });
      const chip = host.querySelector('[data-fk="season-9"]') as HTMLElement;
      Object.defineProperty(chip, 'offsetLeft', { get: () => 900 });
      Object.defineProperty(chip, 'offsetWidth', { get: () => 220 });
      act(() => setFocus('season-1'));
      await flush();
      act(() => setFocus('season-9'));
      await flush();
      expect(left).toBe(900 + 220 + 24 - 600);
    });
  });
});

describe('TV series screen: «Озвучка»', () => {
  // a TorrServer that keeps the data of each torrent and records every «set»
  function server(data: { [hash: string]: string }) {
    const sets: { hash: string; data: string }[] = [];
    mockFetch((url, init) => {
      if (url.indexOf('/torrents') < 0) return { body: '[]' };
      const b = JSON.parse(init.body || '{}');
      if (b.action === 'set') {
        sets.push({ hash: b.hash, data: b.data });
        data[b.hash] = b.data;
        return { body: '{}' };
      }
      return { body: JSON.stringify(fixture.map((x) => ({ ...x, data: data[x.hash] || '' }))) };
    });
    return sets;
  }
  async function mountWithDialogs(data: { [hash: string]: string }) {
    torrents.value = fixture.map((x) => ({ ...x, data: data[x.hash] || '' })) as any;
    const host = document.createElement('div');
    hosts.push(host);
    document.body.appendChild(host);
    act(() => { render(h('div', {}, h(SeriesScreen, { seriesKey: key, season: 2 }), h(DialogHost, {})), host); });
    await flush();
    return host;
  }
  const rec = (a: object) => JSON.stringify({ omp: { v: 1, h: [], a } });
  const options = (host: HTMLElement) => Array.from(host.querySelectorAll('.dialog-option')).map((o) => text(o));
  const open = async (host: HTMLElement) => {
    act(() => { (host.querySelector('[data-fk="series-dub"]') as HTMLElement).click(); });
    await flush();
  };
  const pick = async (host: HTMLElement, n: number) => {
    act(() => { (host.querySelectorAll('.dialog-option')[n] as HTMLElement).click(); });
    await flush();
  };

  it('says «по умолчанию» when nothing is remembered; the list has only the reset', async () => {
    server({});
    const host = await mountWithDialogs({});
    expect(text(host.querySelector('[data-fk="series-dub"]'))).toBe('Озвучка: по умолчанию');
    await open(host);
    expect(options(host)).toEqual(['По умолчанию (сбросить)']);
  });

  it('shows the dub chosen on any season and switches to another seen one, written to TorrServer', async () => {
    const data = { s1: rec({ at: 5, l: 'LostFilm', g: 'ru', s: 'off', k: [{ l: 'LostFilm', g: 'ru' }, { l: 'HDrezka Studio', g: 'ru' }] }) };
    const sets = server(data);
    const host = await mountWithDialogs(data);
    expect(text(host.querySelector('[data-fk="series-dub"]'))).toBe('Озвучка: LostFilm');
    await open(host);
    expect(options(host)).toEqual(['LostFilm · Русский', 'HDrezka Studio · Русский', 'По умолчанию (сбросить)']);
    await pick(host, 1);
    expect(sets.map((x) => x.hash)).toEqual(['s1']);
    expect(JSON.parse(sets[0].data).omp.a).toMatchObject({ l: 'HDrezka Studio', g: 'ru', s: 'off' });
    expect(text(host.querySelector('[data-fk="series-dub"]'))).toBe('Озвучка: HDrezka Studio');
  });

  it('shows the channels with the dub, in the button and the list', async () => {
    const data = { s1: rec({ at: 5, l: 'HDRezka', g: 'ru', c: '5.1', k: [{ l: 'HDRezka', g: 'ru', c: '5.1' }, { l: 'LostFilm', g: 'ru', c: '2.0' }] }) };
    server(data);
    const host = await mountWithDialogs(data);
    expect(text(host.querySelector('[data-fk="series-dub"]'))).toBe('Озвучка: HDRezka · 5.1');
    await open(host);
    expect(options(host)).toEqual(['HDRezka · 5.1 · Русский', 'LostFilm · стерео · Русский', 'По умолчанию (сбросить)']);
  });

  it('a language picked without a dub title is shown and marked current in the list', async () => {
    const data = { s1: rec({ at: 5, g: 'ru', k: [{ l: 'LostFilm', g: 'ru' }] }) };
    server(data);
    const host = await mountWithDialogs(data);
    expect(text(host.querySelector('[data-fk="series-dub"]'))).toBe('Озвучка: Русский');
    await open(host);
    expect(options(host)).toEqual(['Русский', 'LostFilm · Русский', 'По умолчанию (сбросить)']);
    expect(text(host.querySelector('.dialog-option.current'))).toBe('Русский');
  });

  it('«По умолчанию (сбросить)» resets the series, keeping the dubs seen', async () => {
    const data = { s2: rec({ at: 5, l: 'LostFilm', g: 'ru', k: [{ l: 'LostFilm', g: 'ru' }] }) };
    const sets = server(data);
    const host = await mountWithDialogs(data);
    await open(host);
    await pick(host, 1);
    const a = JSON.parse(sets[0].data).omp.a;
    expect(a.l).toBeUndefined();
    expect(a.k).toEqual([{ l: 'LostFilm', g: 'ru' }]);
    expect(text(host.querySelector('[data-fk="series-dub"]'))).toBe('Озвучка: по умолчанию');
  });
});

describe('TV series screen: episodes still to come', () => {
  const plainSeason = stub.season;
  const dated = (n: number, title: string, airDate: string) => ({ n, title, airDate, runtime: 50, overview: '' });
  const withEpisodes = (list: ReturnType<typeof dated>[]) => {
    stub.season = (_id: number, n: number) => Promise.resolve({ number: n, name: '', airDate: '', overview: '', episodes: list });
  };
  afterEach(() => {
    stub.season = plainSeason;
  });
  const coming = (host: HTMLElement) => Array.prototype.slice.call(host.querySelectorAll('.series-episodes .ep-coming')) as HTMLElement[];

  it('after the last episode: dashed muted rows «S02E04 Пирамида · выйдет …», «Серия 5» without a name', async () => {
    withEpisodes([
      dated(1, 'Пилот', '2024-05-08'),
      dated(2, 'Второй', '2024-05-15'),
      dated(3, 'Пропущенная', '2024-05-22'), // out already, just not in the release: no placeholder
      dated(4, 'Пирамида', '2099-01-08'),
      dated(5, 'Эпизод 5', '2099-01-15'),
      dated(6, 'Без даты', ''),
    ]);
    const host = await mount(2);
    const rows = Array.prototype.slice.call(host.querySelectorAll('.series-episodes .ep-row')) as HTMLElement[];
    expect(rows.map((r) => text(r.querySelector('.ep')))).toEqual(['S02E01', 'S02E02', 'S02E04', 'S02E05']);
    const c = coming(host);
    expect(c).toHaveLength(2);
    expect(rows.indexOf(c[0])).toBe(2);
    expect(text(c[0].querySelector('.name'))).toBe('Пирамида');
    expect(text(c[0].querySelector('.size'))).toMatch(/^выйдет \d+ янв/);
    expect(text(c[1].querySelector('.name'))).toBe('Серия 5');
    expect(c.every((r) => r.tagName === 'DIV' && !r.hasAttribute('data-fk') && r.getAttribute('aria-disabled') === 'true')).toBe(true);
    // OK on it does nothing
    const before = currentRoute.value;
    act(() => { c[0].click(); });
    await flush();
    expect(currentRoute.value).toBe(before);
    // the dashed, muted look (Chromium 53: a plain dashed border)
    const css = readFileSync('src/styles.css', 'utf8') as string;
    expect(css).toMatch(/\.ep-coming \{[^}]*border: 2px dashed/);
    expect(css).toMatch(/\.ep-coming \{[^}]*color: var\(--muted\)/);
  });

  it('Down from the last real episode does not land on them', async () => {
    withEpisodes([dated(1, 'Пилот', '2024-05-08'), dated(2, 'Второй', '2024-05-15'), dated(3, 'Пирамида', '2099-01-08')]);
    const host = await mount(2);
    act(() => setFocus('ep-s2-2'));
    await flush();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 40, key: 'ArrowDown', bubbles: true } as KeyboardEventInit)); });
    await flush();
    const k = getCurrentFocusKey();
    expect(k).toBeTruthy();
    expect(host.querySelector('[data-fk="' + k + '"]')).not.toBeNull();
    expect(host.querySelector('.ep-coming.focused')).toBeNull();
  });

  it('an episode out in the release is a normal row, with no placeholder for it', async () => {
    withEpisodes([dated(1, 'Пилот', '2024-05-08'), dated(2, 'Второй', '2099-01-01'), dated(3, 'Пирамида', '2099-01-08')]);
    const host = await mount(2);
    expect(host.querySelector('[data-fk="ep-s2-2"]')).not.toBeNull();
    expect(coming(host).map((r) => text(r.querySelector('.ep')))).toEqual(['S02E03']);
  });

  it('none without TMDB dates or without TMDB at all', async () => {
    withEpisodes([dated(1, 'Пилот', '2024-05-08'), dated(2, 'Второй', '2024-05-15'), dated(3, 'Пирамида', '')]);
    let host = await mount(2);
    expect(coming(host)).toHaveLength(0);
    expect(host.querySelectorAll('.series-episodes .ep-row')).toHaveLength(2);
    stub.season = () => Promise.reject(new Error('offline'));
    resetEpisodeNames();
    host = await mount(2);
    expect(coming(host)).toHaveLength(0);
  });
});
﻿
describe('TV series screen: the season chips say what is there, then what is watched', () => {
  const sub = (host: HTMLElement, n: number) => host.querySelector('[data-fk="season-' + n + '"] .chip-sub') as HTMLElement;

  it('«2 из 9 серий» while TMDB lists more than the release; «· смотрели 1» once one is watched', async () => {
    saveProgress('s2', 1, 100, 100);
    const host = await mount(2);
    expect(text(sub(host, 1))).toBe('2 из 9 серий');
    expect(text(sub(host, 2))).toBe('2 из 10 серий · смотрели 1');
    expect(sub(host, 2).querySelector('.icon')).toBeNull();
  });

  it('without TMDB: the release count; every episode watched: a check icon and «просмотрено»', async () => {
    stub.card = () => Promise.reject(new Error('offline'));
    const plainSeason = stub.season;
    stub.season = () => Promise.reject(new Error('offline'));
    saveProgress('s1', 1, 100, 100);
    saveProgress('s1', 2, 100, 100);
    try {
      const host = await mount(2);
      // (season 2's progress is the previous test's: the progress store outlives localStorage.clear)
      expect(text(sub(host, 2))).toMatch(/^2 серии( · |$)/);
      expect(text(sub(host, 1))).toBe('2 серии · просмотрено');
      expect(sub(host, 1).querySelector('.icon.chip-check')).not.toBeNull();
    } finally {
      stub.season = plainSeason;
    }
  });
});


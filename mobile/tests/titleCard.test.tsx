import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore node builtins, no @types/node in this project
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { TitleCard, wantQuery, defaultSeason, seriesDates } from '../src/screens/catalog/TitleCard';
import { setShareSender } from '../src/share/send';
import { SeasonCard, episodeSub } from '../src/screens/catalog/SeasonCard';
import { App } from '../src/app';
import { setCatalogClientForTests, OFFLINE_TITLE } from '../src/catalog/phoneCatalog';
import { currentRoute, resetTo, navigate, routeStack, goBack } from '../src/nav';
import { torrents } from '../../src/store/library';
import { saveSubs, sameQuery } from '../../src/monitor/subs';
import { t } from '../../src/i18n';
import type { CatalogClient } from '../../src/catalog/client';
import type { CatalogCard, SeasonDetails } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';

const FILM: CatalogCard = {
  kind: 'movie', id: 11, title: 'Полуночный архив', original: 'Midnight Archive', year: 2026,
  poster: 'https://img.test/t/p/w300/a.jpg', rating: 7.4, backdrop: 'https://img.test/t/p/w780/b.jpg',
  genres: ['драма'], runtime: 118, overview: 'Архивариус находит письмо, которого не было.',
  cast: [
    { id: 1, name: 'Ольга Тестова', photo: 'https://img.test/t/p/w185/p.jpg', role: 'Вера', job: 'cast' },
    { id: 2, name: 'Иван Пробный', photo: '', role: 'Архивариус', job: 'cast' },
  ],
  seasons: [], airing: false,
};

const SHOW: CatalogCard = {
  kind: 'tv', id: 21, title: 'Ледяной перевал', original: 'Frost Pass', year: 2024,
  poster: '', rating: 8, backdrop: '', genres: ['фантастика'], runtime: 50, overview: '',
  cast: [],
  seasons: [
    { number: 3, episodes: 10, year: 2026, aired: 4 },
    { number: 2, episodes: 8, year: 2025, aired: 8 },
    { number: 1, episodes: 8, year: 2024, aired: 8 },
  ],
  airing: true,
};

function codeError(code: string): Error {
  const e = new Error('catalog:' + code);
  (e as Error & { code?: string }).code = code;
  return e;
}

type Card = CatalogClient['card'];
type SeasonFn = CatalogClient['season'];

/** A season of SHOW: episodes 1..count, the first two with dates, runtimes and overviews. */
function seasonOf(n: number, count = 3): SeasonDetails {
  return {
    number: n, name: 'Сезон ' + n, airDate: '2024-03-01', overview: '',
    episodes: Array.from({ length: count }, (_, i) => ({
      n: i + 1,
      title: i === 2 ? '' : 'Эпизод ' + n + '.' + (i + 1),
      airDate: i < 2 ? '2024-03-0' + (i + 1) : '',
      runtime: i === 0 ? 48 : i === 1 ? 62 : 0,
      overview: i < 2 ? 'Описание ' + n + '.' + (i + 1) : '',
    })),
  };
}

let seasonCalls: ReturnType<typeof vi.fn<SeasonFn>>;

function fake(impl: Card, season?: SeasonFn) {
  const card = vi.fn<Card>(impl);
  seasonCalls = vi.fn<SeasonFn>(season || ((_id, n) => Promise.resolve(seasonOf(n))));
  setCatalogClientForTests({
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    card,
    season: seasonCalls,
  });
  return card;
}

const serve = (c: CatalogCard, season?: SeasonFn) => fake(() => Promise.resolve(c), season);

// two rounds: the card, then the episodes its season section asks for once rendered
async function flush() {
  for (let round = 0; round < 2; round++) {
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
  }
}

let el: HTMLElement;
function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}

const button = (text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text) as HTMLButtonElement | undefined;
const text = () => el.textContent || '';
const chips = () => Array.from(el.querySelectorAll('.m-tc-chips .m-chip')) as HTMLButtonElement[];
const chip = (label: string) => chips().find((b) => b.textContent === label)!;
const chosen = () => (el.querySelector('.m-tc-chips .m-chip.on') || { textContent: '' }).textContent;
const head = () => el.querySelector('.m-tc-season') as HTMLElement;
const state = () => (head().querySelector('.m-tc-season-state') || { textContent: null }).textContent;
const episodes = () => Array.from(el.querySelectorAll('.m-tc-ep')) as HTMLElement[];

// jsdom has no layout: the overview is made taller than its 4 clamped lines
function overflowOverview(): () => void {
  const proto = HTMLElement.prototype;
  const sh = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
  const ch = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() { return this.classList.contains('m-tc-overview') ? 200 : 0; } });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return this.classList.contains('m-tc-overview') ? 84 : 0; } });
  return () => {
    if (sh) Object.defineProperty(proto, 'scrollHeight', sh);
    else delete (proto as unknown as { scrollHeight?: number }).scrollHeight;
    if (ch) Object.defineProperty(proto, 'clientHeight', ch);
    else delete (proto as unknown as { clientHeight?: number }).clientHeight;
  };
}

function tor(title: string): Torrent {
  return { hash: title, title } as Torrent;
}

beforeEach(() => {
  localStorage.clear();
  torrents.value = [];
  resetTo({ name: 'library' });
  navigate({ name: 'title', kind: 'movie', id: 11 });
});

afterEach(() => {
  act(() => render(null, el));
  setCatalogClientForTests(null);
  setShareSender(null);
});

describe('TitleCard: film', () => {
  it('shares the film from the header: title, year, a short line and the link', async () => {
    serve(FILM);
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    const sent: string[] = [];
    setShareSender(async (o) => {
      sent.push(o.text);
      return 'sheet';
    });
    const share = el.querySelector('.m-tc-share') as HTMLButtonElement;
    expect(share.getAttribute('aria-label')).toBe('Поделиться');
    act(() => share.click());
    expect(sent[0]).toBe('Полуночный архив\n2026\nдрама · 1 ч 58 мин\nhttps://omp-player.online/t/movie/11');
  });

  it('asks the card of its kind and id and shows the fields', async () => {
    const card = serve(FILM);
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    expect(card).toHaveBeenCalledWith('movie', 11);
    expect(el.querySelector('h1')!.textContent).toBe('Полуночный архив');
    expect(el.querySelector('.m-tc-meta')!.textContent).toBe('2026 · драма · 1 ч 58 мин');
    expect(el.querySelector('.m-tc-rating')!.textContent).toBe('★ 7,4 TMDB');
    expect(el.querySelector('.m-tc-backdrop img')!.getAttribute('src')).toBe(FILM.backdrop);
    expect(el.querySelector('.m-tc-poster')!.getAttribute('src')).toBe(FILM.poster);
    expect(el.querySelector('.m-tc-overview')!.textContent).toBe(FILM.overview);
    expect(text()).toContain('В ролях');
    // a photo, else the initial
    const people = Array.from(el.querySelectorAll('.m-tc-person'));
    expect(people).toHaveLength(2);
    expect(people[0].querySelector('img')!.getAttribute('src')).toBe(FILM.cast[0].photo);
    expect(people[1].querySelector('img')).toBeNull();
    expect(people[1].querySelector('.m-tc-initial')!.textContent).toBe('И');
    expect(people[1].textContent).toContain('Иван Пробный');
    // films have no seasons
    expect(text()).not.toContain('Сезоны');
  });

  it('«Найти раздачи» opens «Добавить» with the film query and runs it', async () => {
    serve(FILM);
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    act(() => button('Найти раздачи')!.click());
    expect(currentRoute.value).toEqual({ name: 'add', query: 'Полуночный архив 2026', run: true });
    expect(wantQuery(FILM)).toBe('Полуночный архив 2026');
  });

  it('shows «Хочу посмотреть» without a matching subscription', async () => {
    saveSubs([{ id: 's1', query: 'Другой фильм 2026', quality: '', sources: null, notify: true, createdAt: 1 }]);
    serve(FILM);
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    expect(button('Хочу посмотреть')).toBeTruthy();
    expect(button('Слежу за фильмом')).toBeUndefined();
  });

  it('shows «Слежу за фильмом» for a matching subscription (case and ё ignored) and opens the subscriptions', async () => {
    saveSubs([{ id: 's1', query: 'ПОЛУНОЧНЫЙ  архив 2026', quality: '1080', sources: null, notify: true, createdAt: 1 }]);
    serve({ ...FILM, title: 'Полуночный архив' });
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    expect(button('Хочу посмотреть')).toBeUndefined();
    act(() => button('Слежу за фильмом')!.click());
    expect(currentRoute.value).toEqual({ name: 'news', seg: 'subs' });
  });

  it('collapses a long overview with «Ещё» / «Свернуть»', async () => {
    const restore = overflowOverview();
    try {
      serve(FILM);
      mount(<TitleCard kind="movie" id={11} />);
      await flush();
      const ov = el.querySelector('.m-tc-overview')!;
      expect(ov.classList.contains('open')).toBe(false);
      act(() => button('Ещё')!.click());
      expect(el.querySelector('.m-tc-overview')!.classList.contains('open')).toBe(true);
      act(() => button('Свернуть')!.click());
      expect(el.querySelector('.m-tc-overview')!.classList.contains('open')).toBe(false);
    } finally {
      restore();
    }
  });

  it('no «Ещё» when the overview fits', async () => {
    serve(FILM);
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    expect(el.querySelector('.m-tc-overview')!.textContent).toBe(FILM.overview);
    expect(button('Ещё')).toBeUndefined();
  });

  it('the back button returns to where the card was opened', async () => {
    serve(FILM);
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    act(() => (el.querySelector('button[aria-label="Назад"]') as HTMLButtonElement).click());
    expect(currentRoute.value).toEqual({ name: 'library' });
  });

  it('shows a skeleton while loading', () => {
    fake(() => new Promise(() => {}));
    mount(<TitleCard kind="movie" id={11} />);
    expect(el.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(el.querySelector('button[aria-label="Назад"]')).toBeTruthy();
  });
});

describe('TitleCard: series', () => {
  it('dates, status and rating on one line, every genre on the next', async () => {
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(el.querySelector('.m-tc-meta')!.textContent).toBe('2024 - выходит · Выходит · ★ 8,0');
    expect(el.querySelector('.m-tc-genres')!.textContent).toBe('фантастика');
    act(() => render(null, el));
    serve({ ...SHOW, airing: false, status: 'ended', lastAirDate: '2026-03-01', genres: ['фантастика', 'драма'] });
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(el.querySelector('.m-tc-meta')!.textContent).toBe('2024 - 2026 · Завершён · ★ 8,0');
    expect(el.querySelector('.m-tc-genres')!.textContent).toBe('фантастика, драма');
  });

  it('seriesDates uses the first air year and «выходит» while airing', () => {
    expect(seriesDates(SHOW)).toBe('2024 - выходит');
    expect(seriesDates({ ...SHOW, airing: false, firstAirDate: '2019-01-02', lastAirDate: '2024-05-01' })).toBe('2019 - 2024');
    expect(defaultSeason(SHOW.seasons)).toBe(3);
    expect(defaultSeason([])).toBe(1);
  });

  it('lists every season in order and opens the season card; an unreleased season shows its date', async () => {
    serve({
      ...SHOW,
      seasons: [
        { number: 2, episodes: 8, year: 2026, aired: 0, airDate: '2026-11-01' },
        { number: 1, episodes: 8, year: 2024, aired: 8 },
      ],
    });
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    const rows = Array.from(el.querySelectorAll('.m-tc-season-row'));
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Сезон 1'), expect.stringContaining('Сезон 2')]);
    expect(rows[1].textContent).toContain('нояб.');
    expect(button('Найти раздачи на сезон')).toBeUndefined();
    act(() => (rows[0] as HTMLButtonElement).click());
    expect(currentRoute.value).toEqual({ name: 'seasonCard', id: 21, season: 1 });
    expect(seasonCalls).not.toHaveBeenCalled();
  });

  it('«Смотреть на ТВ» when a season is in the library, else «Найти раздачи»', async () => {
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(button('Найти раздачи')).toBeTruthy();
    expect(button('Смотреть на телефоне')).toBeUndefined();
    act(() => render(null, el));
    torrents.value = [{
      hash: 'h-s1',
      title: 'Ледяной перевал / Frost Pass S01 WEB-DL',
      file_stats: [{ id: 1, path: 'Frost.Pass.S01E01.mkv', length: 1500000000 }],
    } as Torrent];
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(button('Смотреть на телефоне')).toBeTruthy();
    expect(button('Найти раздачи')).toBeUndefined();
  });

  it('creators and actors are separate strips', async () => {
    serve({
      ...SHOW,
      cast: [
        { id: 1, name: 'Ольга Тестова', photo: '', role: 'Вера', job: 'cast' },
        { id: 2, name: 'Иван Пробный', photo: '', role: '', job: 'creator' },
      ],
    });
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    const heads = Array.from(el.querySelectorAll('.m-tc-section h2')).map((h) => h.textContent);
    expect(heads).toContain('Создатели');
    expect(heads).toContain('В ролях');
  });

  it('shows «Слежу за серией» for a subscription to the series query', async () => {
    saveSubs([{ id: 's1', query: 'ледяной перевал', quality: '', sources: null, notify: true, createdAt: 1 }]);
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    act(() => button('Слежу за серией')!.click());
    expect(currentRoute.value).toEqual({ name: 'news', seg: 'subs' });
  });
});

describe('SeasonCard', () => {
  it('keeps a long title whole, below the status bar', async () => {
    const title = 'Я стал сильнейшим в мире с провальным навыком призывателем';
    serve({ ...SHOW, title });
    mount(<SeasonCard id={21} season={1} />);
    await flush();
    const h = el.querySelector('.m-season-title') as HTMLElement;
    expect(h.textContent).toBe(title);
    expect(h.closest('[data-route="season"]')!.classList.contains('m-tc')).toBe(false);
    const back = el.querySelector('[data-code="P25.1"]')!;
    expect(back.closest('.m-season-backdrop')).toBeNull();
    // .tm forces position:relative in test mode and would pull this absolute button into the flow
    expect(back.classList.contains('tm')).toBe(false);
    const css = (readFileSync('mobile/src/mobile.css', 'utf8') as string).replace(/\r\n/g, '\n');
    const hero = /\.m-season-hero \{[^}]+\}/.exec(css)![0];
    expect(hero).toContain('env(safe-area-inset-top)');
    expect(hero).toContain('min-height');
    expect(hero).toContain('16px');
    const backdrop = /\.m-season-backdrop \{[^}]+\}/.exec(css)![0];
    expect(backdrop).toContain('bottom: 0');
    expect(backdrop).not.toContain('height: calc(300px');
    expect(css).toMatch(/\.m-tc \{ padding-top: 0; \}/);
    expect(css).toMatch(/\.m-tc-title \{[^}]*overflow-wrap: anywhere/);
    expect(/\.m-tc-title \{[^}]*line-clamp/.test(css)).toBe(false);
    const titleRule = /\.m-season-title \{[^}]+\}/.exec(css)![0];
    expect(titleRule).toContain('overflow-wrap: anywhere');
    expect(titleRule).not.toContain('line-clamp');
    expect(css).toMatch(/\.m-season-ep-title \{[^}]*-webkit-line-clamp: 2/);
  });

  it('episode line: number, title on the first line, duration and status on the second', async () => {
    expect(episodeSub(52, 'нет в медиатеке')).toBe('52 мин · нет в медиатеке');
    expect(episodeSub(0, '1.4 GB')).toBe('1.4 GB');
    torrents.value = [{
      hash: 'h-s3',
      title: 'Ледяной перевал S03 WEB-DL',
      file_stats: [{ id: 7, path: 'Frost.Pass.S03E01.mkv', length: 1500000000 }],
    } as Torrent];
    serve(SHOW);
    mount(<SeasonCard id={21} season={3} />);
    await flush();
    const e = episodes();
    expect(e[0].classList.contains('in')).toBe(true);
    expect(e[0].querySelector('.m-season-ep-num')!.textContent).toBe('1');
    expect(e[0].querySelector('.m-season-ep-title')!.textContent).toBe('Эпизод 3.1');
    expect(e[0].querySelector('.m-tc-ep-sub')!.textContent).toBe('48 мин · 1,4 ГБ');
    expect(e[2].classList.contains('in')).toBe(false);
    expect(e[2].querySelector('.m-season-ep-title')!.textContent).toBe('Серия 3');
    expect(e[2].querySelector('.m-tc-ep-sub')!.textContent).toBe('50 мин · нет в медиатеке');
    expect(button('Смотреть на телефоне')).toBeTruthy();
  });

  it('an unreleased season has no find button; a future episode shows its date', async () => {
    const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    serve(
      { ...SHOW, seasons: [{ number: 4, episodes: 1, year: 2027, aired: 0, airDate: future }] },
      () => Promise.resolve({
        number: 4, name: '', airDate: future, overview: '',
        episodes: [{ n: 1, title: 'Пилот', airDate: future, runtime: 40, overview: '' }],
      }),
    );
    mount(<SeasonCard id={21} season={4} />);
    await flush();
    expect(button('Найти раздачи на сезон')).toBeUndefined();
    expect(episodes()[0].querySelector('.m-tc-ep-sub')!.textContent).not.toBe('нет в медиатеке');
    const share = el.querySelector('.m-season-share') as HTMLButtonElement;
    expect(share).toBeTruthy();
    const sent: string[] = [];
    setShareSender(async (o) => {
      sent.push(o.text);
      return 'sheet';
    });
    act(() => share.click());
    expect(sent[0]).toContain('Сезон 4 выходит');
    expect(sent[0]).toContain('https://omp-player.online/t/tv/21/s/4');
    expect(sent[0]).not.toMatch(/magnet:|xt=urn:btih/i);
  });

  it('«Серий пока нет» for an empty season', async () => {
    serve(SHOW, (_id, n) => Promise.resolve({ ...seasonOf(n), episodes: [] }));
    mount(<SeasonCard id={21} season={3} />);
    await flush();
    expect(text()).toContain('Серий пока нет');
  });
});

describe('TitleCard: errors', () => {
  it('shows the catalog error with «Повторить», which asks again', async () => {
    let n = 0;
    const card = fake(() => (++n === 1 ? Promise.reject(codeError('offline')) : Promise.resolve(FILM)));
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain(t(OFFLINE_TITLE));
    expect(text()).toContain('TMDB не отвечает из этой сети');
    act(() => button('Повторить')!.click());
    await flush();
    expect(card).toHaveBeenCalledTimes(2);
    expect(el.querySelector('h1')!.textContent).toBe('Полуночный архив');
  });

  it('no key: the no-key text and «Как получить ключ»', async () => {
    fake(() => Promise.reject(codeError('nokey')));
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    expect(text()).toContain('Нет ключа TMDB');
    act(() => button('Как получить ключ')!.click());
    expect(currentRoute.value).toEqual({ name: 'faq', q: 'tmdb-key' });
  });
});

describe('sameQuery', () => {
  it('ignores case, ё and extra spaces', () => {
    expect(sameQuery('Ёлка  2026', 'елка 2026')).toBe(true);
    expect(sameQuery('Ёлка 2026', 'Ёлка 2025')).toBe(false);
  });
});

describe('TitleCard: people', () => {
  it('lists the directors first with their job, and a tap opens the person', async () => {
    serve({
      ...FILM,
      cast: [{ id: 9, name: 'Пётр Режиссёров', photo: '', role: '', job: 'director' }, ...FILM.cast],
    });
    // a person with no job is an actor, not a head
    serve({ ...FILM, cast: [{ id: 5, name: 'Без Роли', photo: '', role: 'Х' } as never, { id: 9, name: 'Пётр Режиссёров', photo: '', role: '', job: 'director' }] });
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    expect(Array.from(el.querySelectorAll('button.m-tc-person')).map((p) => p.querySelector('.m-tc-person-name')!.textContent)).toEqual(['Пётр Режиссёров', 'Без Роли']);
    serve({
      ...FILM,
      cast: [{ id: 9, name: 'Пётр Режиссёров', photo: '', role: '', job: 'director' }, ...FILM.cast],
    });
    mount(<TitleCard kind="movie" id={11} />);
    await flush();
    const people = Array.from(el.querySelectorAll('button.m-tc-person')) as HTMLButtonElement[];
    expect(people.map((p) => p.querySelector('.m-tc-person-name')!.textContent)).toEqual(['Пётр Режиссёров', 'Ольга Тестова', 'Иван Пробный']);
    expect(people[0].textContent).toContain('Режиссёр');
    act(() => people[1].click());
    expect(currentRoute.value).toEqual({ name: 'person', id: 1, label: 'Ольга Тестова' });
  });
});

describe('TitleCard in the app', () => {
  it('renders the card for the route with «Каталог» highlighted', async () => {
    serve(FILM);
    resetTo({ name: 'library' });
    navigate({ name: 'title', kind: 'movie', id: 11 });
    mount(<App />);
    await flush();
    expect(el.querySelector('h1')!.textContent).toBe('Полуночный архив');
    expect(el.querySelector('.m-nav-item.on')!.textContent).toBe('Каталог');
  });
});

describe('TitleCard in English', () => {
  it('renders the English copy', async () => {
    applyLanguageSetting('en');
    const restore = overflowOverview();
    try {
      saveSubs([]);
      serve({ ...SHOW, title: 'Frost Pass', airing: true });
      mount(<TitleCard kind="tv" id={21} />);
      await flush();
      expect(el.querySelector('.m-tc-meta')!.textContent).toBe('2024 - airing · Airing · ★ 8.0');
      expect(el.querySelector('.m-tc-genres')!.textContent).toBe('фантастика');
      expect(button('Find torrents')).toBeTruthy();
      expect(button('Want to watch')).toBeTruthy();
      expect(el.querySelector('button[aria-label="Back"]')).toBeTruthy();
      expect(text()).toContain('Seasons');
      expect(Array.from(el.querySelectorAll('.m-tc-season-row')).map((b) => b.textContent)).toEqual([
        expect.stringContaining('Season 1'),
        expect.stringContaining('Season 2'),
        expect.stringContaining('Season 3'),
      ]);
      act(() => render(null, el));
      saveSubs([{ id: 's1', query: 'Frost Pass', quality: '', sources: null, notify: true, createdAt: 1 }]);
      serve({ ...FILM, title: 'Midnight Archive', genres: ['drama'], cast: [{ id: 3, name: 'Olga Test', photo: '', role: '', job: 'cast' }] });
      mount(<TitleCard kind="movie" id={11} />);
      await flush();
      expect(el.querySelector('.m-tc-meta')!.textContent).toBe('2026 · drama · 1 h 58 min');
      expect(text()).toContain('Cast');
      expect(button('More')).toBeTruthy();
      act(() => button('More')!.click());
      expect(button('Collapse')).toBeTruthy();
      act(() => render(null, el));
      saveSubs([{ id: 's1', query: 'midnight archive 2026', quality: '', sources: null, notify: true, createdAt: 1 }]);
      serve({ ...FILM, title: 'Midnight Archive' });
      mount(<TitleCard kind="movie" id={11} />);
      await flush();
      expect(button('Following this film')).toBeTruthy();
      act(() => render(null, el));
      saveSubs([{ id: 's1', query: 'frost pass', quality: '', sources: null, notify: true, createdAt: 1 }]);
      serve({ ...SHOW, title: 'Frost Pass' });
      mount(<TitleCard kind="tv" id={21} />);
      await flush();
      expect(button('Following this series')).toBeTruthy();
      torrents.value = [{
        hash: 'h-s2',
        title: 'Frost Pass S02 1080p WEB-DL',
        file_stats: [{ id: 1, path: 'Frost.Pass.S02E01.mkv', length: 1000 }],
      } as Torrent];
      act(() => render(null, el));
      mount(<TitleCard kind="tv" id={21} />);
      await flush();
      expect(button('Watch on the phone')).toBeTruthy();
    } finally {
      restore();
      applyLanguageSetting('ru');
    }
  });
});

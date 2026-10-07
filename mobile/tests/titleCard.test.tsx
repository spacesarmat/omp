import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { TitleCard, wantQuery, defaultSeason } from '../src/screens/catalog/TitleCard';
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
});

describe('TitleCard: film', () => {
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
  it('meta line: start year only while airing, the span when ended', async () => {
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(el.querySelector('.m-tc-meta')!.textContent).toBe('Сериал · 2024 · фантастика');
    act(() => render(null, el));
    serve({ ...SHOW, airing: false });
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(el.querySelector('.m-tc-meta')!.textContent).toBe('Сериал · 2024–2026 · фантастика');
    act(() => render(null, el));
    serve({ ...SHOW, airing: false, seasons: [{ number: 1, episodes: 8, year: 2024, aired: 8 }] });
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(el.querySelector('.m-tc-meta')!.textContent).toBe('Сериал · 2024 · фантастика');
  });

  it('a chip per season in order, the last aired season chosen; specials are not listed', async () => {
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(text()).toContain('Сезоны');
    expect(chips().map((b) => b.textContent)).toEqual(['Сезон 1', 'Сезон 2', 'Сезон 3']);
    expect(chosen()).toBe('Сезон 3');
    expect(chip('Сезон 3').getAttribute('aria-pressed')).toBe('true');
    expect(head().querySelector('.m-tc-season-name')!.textContent).toBe('Сезон 3');
    expect(head().querySelector('.m-tc-season-sub')!.textContent).toBe('2026 · 10 серий');
    expect(state()).toBe('выходит: 4 из 10');
    expect(seasonCalls).toHaveBeenCalledTimes(1);
    expect(seasonCalls).toHaveBeenCalledWith(21, 3, { full: true });
  });

  it('default chip: the last season with aired episodes, else the first', () => {
    expect(defaultSeason(SHOW.seasons)).toBe(3);
    expect(defaultSeason([{ number: 3, episodes: 10, year: 2026, aired: 0 }, ...SHOW.seasons.slice(1)])).toBe(2);
    expect(defaultSeason([{ number: 2, episodes: 8, year: 0, aired: 0 }, { number: 1, episodes: 8, year: 0, aired: 0 }])).toBe(1);
    expect(defaultSeason([])).toBe(1);
  });

  it('switching loads the chosen season; the chosen chip again asks nothing', async () => {
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    act(() => chip('Сезон 1').click());
    await flush();
    expect(chosen()).toBe('Сезон 1');
    expect(seasonCalls.mock.calls.map((c) => c[1])).toEqual([3, 1]);
    expect(head().querySelector('.m-tc-season-sub')!.textContent).toBe('2024 · 8 серий');
    expect(state()).toBeNull();
    expect(episodes()[0].textContent).toContain('Эпизод 1.1');
    // the chosen chip again: nothing new
    act(() => chip('Сезон 1').click());
    await flush();
    expect(seasonCalls).toHaveBeenCalledTimes(2);
    // back to season 3: asked again, the client answers from its 24 h cache (client.test)
    act(() => chip('Сезон 3').click());
    await flush();
    expect(seasonCalls.mock.calls.map((c) => c[1])).toEqual([3, 1, 3]);
    expect(episodes()[0].textContent).toContain('Эпизод 3.1');
  });

  it('episodes: number, title (else «Серия N»), date and runtime; one overview open at a time', async () => {
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    const e = episodes();
    expect(e).toHaveLength(3);
    expect(e[0].querySelector('.m-tc-ep-num')!.textContent).toBe('1');
    expect(e[0].querySelector('.m-tc-ep-title')!.textContent).toBe('Эпизод 3.1');
    expect(e[0].querySelector('.m-tc-ep-sub')!.textContent).toBe('1 мар. 2024 · 48 мин');
    expect(e[1].querySelector('.m-tc-ep-sub')!.textContent).toBe('2 мар. 2024 · 1 ч 2 мин');
    expect(e[2].querySelector('.m-tc-ep-title')!.textContent).toBe('Серия 3');
    expect(e[2].querySelector('.m-tc-ep-sub')).toBeNull();
    expect(el.querySelector('.m-tc-ep-overview')).toBeNull();
    act(() => (e[0].querySelector('button') as HTMLButtonElement).click());
    expect(el.querySelector('.m-tc-ep-overview')!.textContent).toBe('Описание 3.1');
    expect(e[0].querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    act(() => (episodes()[1].querySelector('button') as HTMLButtonElement).click());
    expect(Array.from(el.querySelectorAll('.m-tc-ep-overview')).map((x) => x.textContent)).toEqual(['Описание 3.2']);
    // no overview: nothing to open
    act(() => (episodes()[2].querySelector('button') as HTMLButtonElement).click());
    expect(Array.from(el.querySelectorAll('.m-tc-ep-overview')).map((x) => x.textContent)).toEqual(['Описание 3.2']);
    act(() => (episodes()[1].querySelector('button') as HTMLButtonElement).click());
    expect(el.querySelector('.m-tc-ep-overview')).toBeNull();
  });

  it('a skeleton while the episodes load; «Серий пока нет» for an empty season', async () => {
    serve(SHOW, () => new Promise(() => {}));
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(el.querySelector('.m-tc-episodes[aria-busy="true"]')).toBeTruthy();
    act(() => render(null, el));
    serve(SHOW, (_id, n) => Promise.resolve({ ...seasonOf(n), episodes: [] }));
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(text()).toContain('Серий пока нет');
  });

  it('an episodes error stays inside the season with «Повторить», which asks again', async () => {
    let n = 0;
    serve(SHOW, (_id, s) => (++n === 1 ? Promise.reject(codeError('offline')) : Promise.resolve(seasonOf(s))));
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    const alert = el.querySelector('.m-tc-ep-error[role="alert"]')!;
    expect(alert.textContent).toContain('Не удалось загрузить серии');
    // the card itself is still there
    expect(el.querySelector('h1')!.textContent).toBe('Ледяной перевал');
    act(() => (alert.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(seasonCalls).toHaveBeenCalledTimes(2);
    expect(el.querySelector('.m-tc-ep-error')).toBeNull();
    expect(episodes()).toHaveLength(3);
  });

  it('«Найти раздачи» searches the series, «Найти раздачи на сезон» the chosen season', async () => {
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    act(() => button('Найти раздачи')!.click());
    expect(currentRoute.value).toEqual({ name: 'add', query: 'Ледяной перевал', run: true });
    routeStack.value = [{ name: 'library' }, { name: 'title', kind: 'tv', id: 21 }];
    act(() => chip('Сезон 2').click());
    act(() => button('Найти раздачи на сезон')!.click());
    expect(currentRoute.value).toEqual({ name: 'add', query: 'Ледяной перевал 2 сезон', run: true });
  });

  it('a season in the library: «В медиатеке», «Открыть в медиатеке» opens the first matching torrent, «Найти раздачи» stays', async () => {
    torrents.value = [
      { hash: 'h-old', title: 'Ледяной перевал WEB-DL 1080p' } as Torrent,
      { hash: 'h-s2', title: 'Ледяной перевал / Frost Pass (2025) 2 сезон WEB-DL 1080p' } as Torrent,
      { hash: 'h-s2b', title: 'Frost Pass S02 2160p' } as Torrent,
    ];
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    // season 3 is not in the library
    expect(button('Открыть в медиатеке')).toBeUndefined();
    expect(button('Найти раздачи на сезон')).toBeTruthy();
    act(() => chip('Сезон 2').click());
    await flush();
    expect(state()).toBe('В медиатеке');
    expect(button('Найти раздачи на сезон')).toBeUndefined();
    act(() => button('Открыть в медиатеке')!.click());
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'h-s2' });
    routeStack.value = [{ name: 'library' }, { name: 'title', kind: 'tv', id: 21 }];
    const finds = Array.from(el.querySelectorAll('.m-tc-season-actions button')).map((b) => b.textContent);
    expect(finds).toEqual(['Открыть в медиатеке', 'Найти раздачи']);
    act(() => (el.querySelectorAll('.m-tc-season-actions button')[1] as HTMLButtonElement).click());
    expect(currentRoute.value).toEqual({ name: 'add', query: 'Ледяной перевал 2 сезон', run: true });
  });

  it('a season range marks each season in it; a season-less torrent marks none', async () => {
    torrents.value = [tor('Ледяной перевал WEB-DL 1080p')];
    serve({ ...SHOW, airing: false });
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(state()).toBeNull();
    act(() => render(null, el));
    torrents.value = [tor('Ледяной перевал / Frost Pass / Сезоны: 1-3 (2024-2026) WEB-DL')];
    serve({ ...SHOW, airing: false });
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    const marks: Array<string | null> = [];
    ['Сезон 1', 'Сезон 2', 'Сезон 3'].forEach((c) => {
      act(() => chip(c).click());
      marks.push(state());
    });
    expect(marks).toEqual(['В медиатеке', 'В медиатеке', 'В медиатеке']);
  });

  it('no «выходит» when the series is not airing or the latest season is complete', async () => {
    serve({ ...SHOW, airing: false });
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(text()).not.toContain('выходит');
    act(() => render(null, el));
    serve({ ...SHOW, seasons: [{ number: 2, episodes: 8, year: 2025, aired: 8 }, { number: 1, episodes: 8, year: 2024, aired: 8 }] });
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(text()).not.toContain('выходит');
  });

  it('keeps the chosen season through «Назад» from a screen opened over the card', async () => {
    serve(SHOW);
    resetTo({ name: 'library' });
    navigate({ name: 'title', kind: 'tv', id: 21 });
    mount(<App />);
    await flush();
    act(() => chip('Сезон 1').click());
    await flush();
    act(() => button('Найти раздачи на сезон')!.click());
    await flush();
    expect(currentRoute.value).toEqual({ name: 'add', query: 'Ледяной перевал 1 сезон', run: true });
    act(() => {
      goBack();
    });
    await flush();
    expect(chosen()).toBe('Сезон 1');
    // a card opened anew starts on the default season
    act(() => {
      goBack();
    });
    act(() => navigate({ name: 'title', kind: 'tv', id: 21 }));
    await flush();
    expect(chosen()).toBe('Сезон 3');
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
      expect(el.querySelector('.m-tc-meta')!.textContent).toBe('Series · 2024 · фантастика');
      expect(el.querySelector('.m-tc-rating')!.textContent).toBe('★ 8.0 TMDB');
      expect(button('Find torrents')).toBeTruthy();
      expect(button('Want to watch')).toBeTruthy();
      expect(el.querySelector('button[aria-label="Back"]')).toBeTruthy();
      expect(text()).toContain('Seasons');
      expect(chips().map((b) => b.textContent)).toEqual(['Season 1', 'Season 2', 'Season 3']);
      expect(head().querySelector('.m-tc-season-name')!.textContent).toBe('Season 3');
      expect(head().querySelector('.m-tc-season-sub')!.textContent).toBe('2026 · 10 episodes');
      expect(state()).toBe('airing: 4 of 10');
      expect(button('Find torrents for the season')).toBeTruthy();
      expect(episodes()[0].querySelector('.m-tc-ep-sub')!.textContent).toBe('Mar 1, 2024 · 48 min');
      expect(episodes()[2].querySelector('.m-tc-ep-title')!.textContent).toBe('Episode 3');
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
      torrents.value = [tor('Frost Pass S02 1080p WEB-DL')];
      act(() => render(null, el));
      mount(<TitleCard kind="tv" id={21} />);
      await flush();
      act(() => chip('Season 2').click());
      await flush();
      expect(state()).toBe('In library');
      expect(button('Open in library')).toBeTruthy();
      act(() => render(null, el));
      serve(SHOW, () => Promise.reject(codeError('offline')));
      mount(<TitleCard kind="tv" id={21} />);
      await flush();
      expect(el.querySelector('.m-tc-ep-error')!.textContent).toContain('Could not load the episodes');
      expect(button('Retry')).toBeTruthy();
    } finally {
      restore();
      applyLanguageSetting('ru');
    }
  });
});

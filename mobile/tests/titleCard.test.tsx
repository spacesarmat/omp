import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { TitleCard, wantQuery } from '../src/screens/catalog/TitleCard';
import { App } from '../src/app';
import { setCatalogClientForTests, OFFLINE_TITLE } from '../src/catalog/phoneCatalog';
import { currentRoute, resetTo, navigate, routeStack } from '../src/nav';
import { torrents } from '../../src/store/library';
import { saveSubs, sameQuery } from '../../src/monitor/subs';
import { t } from '../../src/i18n';
import type { CatalogClient } from '../../src/catalog/client';
import type { CatalogCard, Kind } from '../../src/catalog/tmdb';
import type { Torrent } from '../../src/api/types';

const FILM: CatalogCard = {
  kind: 'movie', id: 11, title: 'Полуночный архив', original: 'Midnight Archive', year: 2026,
  poster: 'https://img.test/t/p/w300/a.jpg', rating: 7.4, backdrop: 'https://img.test/t/p/w780/b.jpg',
  genres: ['драма'], runtime: 118, overview: 'Архивариус находит письмо, которого не было.',
  cast: [
    { name: 'Ольга Тестова', photo: 'https://img.test/t/p/w185/p.jpg', role: 'Вера' },
    { name: 'Иван Пробный', photo: '', role: 'Архивариус' },
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

function fake(impl: Card) {
  const card = vi.fn<Card>(impl);
  setCatalogClientForTests({
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    card,
  });
  return card;
}

const serve = (c: CatalogCard) => fake(() => Promise.resolve(c));

async function flush() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
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
const rows = () => Array.from(el.querySelectorAll('.m-tc-season')) as HTMLElement[];

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

  it('lists the seasons with episodes, year and «выходит» on the airing one', async () => {
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    expect(text()).toContain('Сезоны');
    const r = rows();
    expect(r).toHaveLength(3);
    expect(r[0].querySelector('.m-tc-season-name')!.textContent).toBe('3 сезон');
    expect(r[0].querySelector('.m-tc-season-sub')!.textContent).toBe('10 серий · 2026');
    expect(r[0].querySelector('.m-tc-season-state')!.textContent).toBe('выходит: 4 из 10');
    expect(r[1].querySelector('.m-tc-season-sub')!.textContent).toBe('8 серий · 2025');
    expect(r[1].querySelector('.m-tc-season-state')).toBeNull();
    expect(r[2].querySelector('.m-tc-season-state')).toBeNull();
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

  it('marks «В медиатеке» on the season found in the library', async () => {
    torrents.value = [tor('Ледяной перевал / Frost Pass (2025) 2 сезон WEB-DL 1080p')];
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    const r = rows();
    expect(r[1].querySelector('.m-tc-season-state')!.textContent).toBe('В медиатеке');
    expect(r[2].querySelector('.m-tc-season-state')).toBeNull();
    expect(r[0].querySelector('.m-tc-season-state')!.textContent).toBe('выходит: 4 из 10');
  });

  it('«Найти раздачи» searches the series, «Найти» on a row searches that season', async () => {
    serve(SHOW);
    mount(<TitleCard kind="tv" id={21} />);
    await flush();
    act(() => button('Найти раздачи')!.click());
    expect(currentRoute.value).toEqual({ name: 'add', query: 'Ледяной перевал', run: true });
    routeStack.value = [{ name: 'library' }, { name: 'title', kind: 'tv', id: 21 }];
    act(() => (rows()[1].querySelector('button') as HTMLButtonElement).click());
    expect(currentRoute.value).toEqual({ name: 'add', query: 'Ледяной перевал 2 сезон', run: true });
    expect(rows()[1].querySelector('button')!.textContent).toBe('Найти');
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
      const r = rows();
      expect(r[0].querySelector('.m-tc-season-name')!.textContent).toBe('Season 3');
      expect(r[0].querySelector('.m-tc-season-sub')!.textContent).toBe('10 episodes · 2026');
      expect(r[0].querySelector('.m-tc-season-state')!.textContent).toBe('airing: 4 of 10');
      expect(r[0].querySelector('button')!.textContent).toBe('Find');
      act(() => render(null, el));
      saveSubs([{ id: 's1', query: 'Frost Pass', quality: '', sources: null, notify: true, createdAt: 1 }]);
      serve({ ...FILM, title: 'Midnight Archive', genres: ['drama'], cast: [{ name: 'Olga Test', photo: '', role: '' }] });
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
      torrents.value = [tor('Frost Pass (2025) Season 2 1080p')];
      act(() => render(null, el));
      mount(<TitleCard kind="tv" id={21} />);
      await flush();
      expect(rows()[1].querySelector('.m-tc-season-state')!.textContent).toBe('In library');
    } finally {
      restore();
      applyLanguageSetting('ru');
    }
  });
});

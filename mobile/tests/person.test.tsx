import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Person } from '../src/screens/catalog/Person';
import { App } from '../src/app';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { currentRoute, resetTo, navigate } from '../src/nav';
import { catalogMode } from '../src/catalog/phoneCatalog';
import { torrents } from '../../src/store/library';
import type { CatalogClient } from '../../src/catalog/client';

const credit = (kind: string, id: number, title: string, year: number, over: Record<string, unknown> = {}) => ({
  kind, id, title, original: title, year, poster: 'http://img/' + id + '.jpg', rating: 7, roles: [], genreIds: [18],
  date: year + '-01-01', popularity: 10, ...over,
});

const CARD = {
  id: 7, name: 'Иван Режиссёров', photo: '', birth: '1970-05-01', death: '', bio: '', known: 'acting',
  acting: [
    credit('movie', 11, 'Другой фильм', 2022, { popularity: 50, roles: ['Пётр', 'Голос'] }),
    credit('movie', 10, 'Тихий сигнал', 2024, { original: 'Quiet Signal', popularity: 5, roles: ['Лев'] }),
    credit('tv', 12, 'Сериал', 2020, { popularity: 20 }),
  ],
  directing: [] as unknown[],
};

const fixture = [{ hash: 'f1', title: 'Тихий сигнал / Quiet Signal (2024) 2160p', category: 'movie', timestamp: 1 }];

let el: HTMLElement;
let person: ReturnType<typeof vi.fn>;

function serve(card: unknown) {
  person = vi.fn(() => Promise.resolve(card));
  setCatalogClientForTests({
    novelties: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    discover: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    search: vi.fn(() => Promise.resolve({ items: [], pages: 0 })),
    card: vi.fn(() => Promise.reject(new Error('x'))),
    person: person as unknown as CatalogClient['person'],
  });
}

async function flush() {
  for (let round = 0; round < 2; round++) await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
}

function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}

const text = (e: Element | null) => (e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : '');
const tiles = () => Array.from(el.querySelectorAll('.m-disc-tile')) as HTMLElement[];
const ids = () => tiles().map((x) => x.getAttribute('data-anchor'));
const btn = (label: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === label) as HTMLButtonElement;
const click = async (e: Element) => {
  await act(async () => { (e as HTMLElement).click(); });
  await flush();
};

beforeEach(() => {
  localStorage.clear();
  torrents.value = fixture as never;
  resetTo({ name: 'library' });
  navigate({ name: 'person', id: 7, label: 'Иван Режиссёров' });
  serve(CARD);
});

afterEach(() => {
  act(() => render(null, el));
  setCatalogClientForTests(null);
});

describe('phone person screen', () => {
  it('the screen root has no m-library class, so the back bar sits at the same top as on the series screen', async () => {
    mount(<Person id={7} label="Иван Режиссёров" />);
    await flush();
    const root = el.querySelector('[data-route="person"]')!;
    expect(root.classList.contains('m-library')).toBe(false);
  });
  it('shows the name, the job and the years', async () => {
    mount(<Person id={7} label="Иван Режиссёров" />);
    await flush();
    expect(person).toHaveBeenCalledWith(7);
    expect(text(el.querySelector('.m-person-name'))).toBe('Иван Режиссёров');
    expect(text(el.querySelector('.m-person-job'))).toBe('Актёр · род. 1970');
    expect(el.querySelector('.m-person-years')).toBeNull();
    expect(text(el.querySelector('.m-tc-initial'))).toBe('ИР');
  });

  it('lists the library title first, marked, with the roles line', async () => {
    mount(<Person id={7} />);
    await flush();
    expect(ids()).toEqual(['movie:10', 'movie:11', 'tv:12']);
    const owned = tiles()[0];
    expect(owned.className).toContain('m-person-owned');
    expect(text(owned.querySelector('.m-disc-badge'))).toBe('В медиатеке');
    expect(text(owned.querySelector('.m-person-roles'))).toBe('Лев');
    expect(text(tiles()[1].querySelector('.m-person-roles'))).toBe('Пётр, Голос');
    expect(tiles()[1].className).not.toContain('m-person-owned');
  });

  it('a tap on a library title opens it, on another one its card', async () => {
    mount(<Person id={7} />);
    await flush();
    await click(tiles()[0]);
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'f1' });
    resetTo({ name: 'library' });
    navigate({ name: 'person', id: 7 });
    mount(<Person id={7} />);
    await flush();
    await click(tiles()[2]);
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'tv', id: 12 });
  });

  it('opens a series of the library on its series screen', async () => {
    torrents.value = [{ hash: 's1', title: 'Сериал / Сезон: 1 (2020) WEB-DL 1080p', category: 'tv', timestamp: 1 }] as never;
    mount(<Person id={7} />);
    await flush();
    await click(tiles()[0]);
    expect(currentRoute.value.name).toBe('series');
  });

  it('«В медиатеке» leaves only the library titles, the empty text otherwise', async () => {
    mount(<Person id={7} />);
    await flush();
    await click(btn('В медиатеке'));
    expect(ids()).toEqual(['movie:10']);
    await click(btn('Все'));
    expect(ids()).toHaveLength(3);
    torrents.value = [];
    await flush();
    await click(btn('В медиатеке'));
    expect(ids()).toEqual([]);
    expect(text(el)).toContain('В медиатеке нет фильмов с Иван Режиссёров');
  });

  it('shows the job segment only when the person has both', async () => {
    mount(<Person id={7} />);
    await flush();
    expect(btn('Режиссёрские работы')).toBeUndefined();
    serve({ ...CARD, known: 'directing', directing: [credit('movie', 30, 'Режиссура', 2019)] });
    mount(<Person id={7} />);
    await flush();
    expect(text(el.querySelector('.m-person-job'))).toBe('Режиссёр · род. 1970');
    expect(ids()).toEqual(['movie:30']);
    await click(btn('Актёрские работы'));
    expect(ids()).toHaveLength(3);
  });

  it('has the «Мои / Обзор» switch with «Обзор» active; «Мои» goes to the library root', async () => {
    mount(<Person id={7} />);
    await flush();
    const tabs = Array.from(el.querySelectorAll('.m-seg [role="tab"]')) as HTMLElement[];
    expect(tabs.map((x) => text(x))).toEqual(['Мои', 'Обзор']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    await click(tabs[0]);
    expect(currentRoute.value).toEqual({ name: 'library' });
    expect(catalogMode.value).toBe('mine');
  });

  it('«Обзор» in the switch goes to the discover root', async () => {
    mount(<Person id={7} />);
    await flush();
    const tabs = Array.from(el.querySelectorAll('.m-seg [role="tab"]')) as HTMLElement[];
    await click(tabs[1]);
    expect(currentRoute.value).toEqual({ name: 'library' });
    expect(catalogMode.value).toBe('discover');
  });

  it('shows the biography clamped; «Ещё» expands and «Свернуть» collapses it', async () => {
    const sh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 200 });
    try {
      serve({ ...CARD, bio: 'Родился в 1970. Снял много фильмов.' });
      mount(<Person id={7} />);
      await flush();
      const p = el.querySelector('.m-tc-overview')!;
      expect(text(p)).toBe('Родился в 1970. Снял много фильмов.');
      expect(p.className).not.toContain('open');
      await click(btn('Ещё'));
      expect(el.querySelector('.m-tc-overview')!.className).toContain('open');
      await click(btn('Свернуть'));
      expect(el.querySelector('.m-tc-overview')!.className).not.toContain('open');
    } finally {
      if (sh) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', sh);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    }
  });

  it('has no biography block without a bio', async () => {
    mount(<Person id={7} />);
    await flush();
    expect(el.querySelector('.m-tc-overview')).toBeNull();
  });

  it('the sort button cycles popular / year with an accessible label', async () => {
    torrents.value = [];
    mount(<Person id={7} />);
    await flush();
    const sort = () => el.querySelector('.m-icon-btn.m-sort') as HTMLButtonElement;
    expect(sort().getAttribute('aria-label')).toBe('Сортировка: Популярные');
    expect(ids()).toEqual(['movie:11', 'tv:12', 'movie:10']);
    await click(sort());
    expect(sort().getAttribute('aria-label')).toBe('Сортировка: По году');
    expect(ids()).toEqual(['movie:10', 'movie:11', 'tv:12']);
    await click(sort());
    expect(ids()).toEqual(['movie:11', 'tv:12', 'movie:10']);
  });

  it('keeps «Все / В медиатеке» and the sort button in one row', async () => {
    mount(<Person id={7} />);
    await flush();
    const row = el.querySelector('.m-person-filters')!;
    expect(row.querySelector('.m-sort')).not.toBeNull();
    expect(text(row)).toContain('В медиатеке');
  });

  it('shows the error with «Повторить»', async () => {
    serve(CARD);
    person.mockImplementation(() => Promise.reject(Object.assign(new Error('offline'), { code: 'offline' })));
    mount(<Person id={7} />);
    await flush();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    person.mockImplementation(() => Promise.resolve(CARD));
    await click(btn('Повторить'));
    expect(text(el.querySelector('.m-person-name'))).toBe('Иван Режиссёров');
  });

  it('the name is in the head block only: the m-bar has just the back button', async () => {
    mount(<Person id={7} label="Иван Режиссёров" />);
    await flush();
    expect(el.querySelector('.m-bar-title')).toBeNull();
    expect(el.querySelectorAll('.m-bar > *').length).toBe(1);
    expect(el.textContent!.split('Иван Режиссёров').length - 1).toBe(1);
  });

  it('has the back button at the left of an m-bar and it goes back', async () => {
    mount(<Person id={7} label="Иван Режиссёров" />);
    await flush();
    const back = el.querySelector('.m-bar > .m-icon-btn:first-child') as HTMLButtonElement;
    expect(back.getAttribute('aria-label')).toBe('Назад');
    act(() => back.click());
    expect(currentRoute.value).toEqual({ name: 'library' });
  });

  it('in the app: renders for the route with «Каталог» highlighted', async () => {
    mount(<App />);
    await flush();
    expect(text(el.querySelector('.m-person-name'))).toBe('Иван Режиссёров');
    expect(text(el.querySelector('.m-nav-item.on'))).toBe('Каталог');
  });

  it('Back from a person opened over a series screen returns to that series screen', async () => {
    resetTo({ name: 'library' });
    navigate({ name: 'series', key: 'k1' });
    navigate({ name: 'person', id: 7 });
    mount(<App />);
    await flush();
    expect(text(el.querySelector('.m-nav-item.on'))).toBe('Каталог');
    await click(el.querySelector('.m-bar > .m-icon-btn:first-child')!);
    expect(currentRoute.value).toEqual({ name: 'series', key: 'k1' });
  });
});

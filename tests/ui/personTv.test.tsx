import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { PersonScreen } from '../../src/screens/Person';
import { torrents } from '../../src/store/library';
import { currentRoute, routeStack } from '../../src/ui/nav';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { wantList } from '../../src/store/wantList';
import { dispatchKey } from '../../src/ui/keys';

const fixture = [
  { hash: 'f1', title: 'Тихий сигнал / Quiet Signal (2024) 2160p', category: 'movie', timestamp: 1 },
];

const credit = (kind: string, id: number, title: string, year: number, over: Record<string, unknown> = {}) => ({
  kind, id, title, original: title, year, poster: 'http://img/' + id + '.jpg', rating: 7, roles: [], genreIds: [18],
  date: year + '-01-01', popularity: 10, ...over,
});

const card = {
  id: 7, name: 'Иван Режиссёров', photo: '', birth: '1970-05-01', death: '', bio: '', known: 'acting',
  acting: [
    credit('movie', 11, 'Другой фильм', 2022, { popularity: 50, roles: ['Пётр', 'Голос'] }),
    credit('movie', 10, 'Тихий сигнал', 2024, { original: 'Quiet Signal', popularity: 5, roles: ['Лев'] }),
    credit('tv', 12, 'Сериал', 2020, { popularity: 20 }),
  ],
  directing: [] as unknown[],
};

let stub: any;

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  wantList.value = [];
  stub = { person: vi.fn(() => Promise.resolve(card)) };
  setCatalogProvider(() => Promise.resolve(stub));
  torrents.value = fixture as any;
  routeStack.value = [{ name: 'library' }, { name: 'person', id: 7, label: 'Иван Режиссёров' }];
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  while (hosts.length) {
    const host = hosts.pop()!;
    act(() => { render(null, host); });
  }
  setCatalogProvider(null);
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(() => Promise.resolve());
};
const text = (el: Element | null) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
const click = async (el: Element) => {
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};

async function mount() {
  const host = document.createElement('div');
  hosts.push(host);
  document.body.appendChild(host);
  act(() => { render(h('div', { class: 'screen-host' }, h(PersonScreen as any, { id: 7, name: 'Иван Режиссёров' })), host); });
  await flush();
  return host;
}

const keys = (host: Element) =>
  (Array.prototype.slice.call(host.querySelectorAll('.disc-tile')) as HTMLElement[]).map((e) => e.getAttribute('data-fk'));

describe('TV person screen', () => {
  it('shows the name, the job and the years', async () => {
    const host = await mount();
    expect(stub.person).toHaveBeenCalledWith(7);
    expect(text(host.querySelector('.person-name'))).toBe('Иван Режиссёров');
    expect(text(host.querySelector('.person-job'))).toBe('Актёр');
    expect(text(host.querySelector('.person-years'))).toBe('род. 1970');
    expect(text(host.querySelector('.tc-initials'))).toBe('ИР');
  });

  it('shows the years of a person who has died', async () => {
    stub.person = vi.fn(() => Promise.resolve({ ...card, death: '2010-02-03' }));
    const host = await mount();
    expect(text(host.querySelector('.person-years'))).toBe('1970–2010');
  });

  it('lists the library title first, marked, with the roles in the meta line', async () => {
    const host = await mount();
    expect(keys(host)).toEqual(['person-tile-movie-10', 'person-tile-movie-11', 'person-tile-tv-12']);
    const owned = host.querySelector('[data-fk="person-tile-movie-10"]')!;
    expect(owned.className).toContain('person-owned');
    expect(text(owned.querySelector('.disc-mark'))).toBe('В медиатеке');
    expect(text(owned.querySelector('.disc-meta'))).toBe('2024 · Лев');
    expect(text(host.querySelector('[data-fk="person-tile-movie-11"] .disc-meta'))).toBe('2022 · Пётр, Голос');
    expect(host.querySelector('[data-fk="person-tile-movie-11"]')!.className).not.toContain('person-owned');
    expect(getCurrentFocusKey()).toBe('person-tile-movie-10');
  });

  it('OK on a library title opens it in «Мои», on another one its card', async () => {
    let host = await mount();
    await click(host.querySelector('[data-fk="person-tile-movie-10"]')!);
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'f1' });
    routeStack.value = [{ name: 'library' }, { name: 'person', id: 7 }];
    host = await mount();
    await click(host.querySelector('[data-fk="person-tile-tv-12"]')!);
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'tv', id: 12 });
  });

  it('opens a series of the library on its series screen', async () => {
    torrents.value = [{ hash: 's1', title: 'Сериал / Сезон: 1 (2020) WEB-DL 1080p', category: 'tv', timestamp: 1 }] as any;
    const host = await mount();
    await click(host.querySelector('[data-fk="person-tile-tv-12"]')!);
    expect(currentRoute.value.name).toBe('series');
  });

  it('«В медиатеке» leaves only the library titles', async () => {
    const host = await mount();
    await click(host.querySelector('[data-fk="person-filter-owned"]')!);
    expect(keys(host)).toEqual(['person-tile-movie-10']);
    await click(host.querySelector('[data-fk="person-filter-all"]')!);
    expect(keys(host)).toHaveLength(3);
  });

  it('with no library title the filter shows the empty text', async () => {
    torrents.value = [];
    const host = await mount();
    await click(host.querySelector('[data-fk="person-filter-owned"]')!);
    expect(keys(host)).toEqual([]);
    expect(text(host.querySelector('.empty'))).toBe('В медиатеке нет фильмов с Иван Режиссёров');
  });

  it('sorts by year on demand', async () => {
    torrents.value = [];
    const host = await mount();
    expect(keys(host)).toEqual(['person-tile-movie-11', 'person-tile-tv-12', 'person-tile-movie-10']);
    expect(text(host.querySelector('[data-fk="person-sort"]'))).toContain('Популярные');
    await click(host.querySelector('[data-fk="person-sort"]')!);
    expect(keys(host)).toEqual(['person-tile-movie-10', 'person-tile-movie-11', 'person-tile-tv-12']);
    expect(text(host.querySelector('[data-fk="person-sort"]'))).toContain('По году');
    await click(host.querySelector('[data-fk="person-sort"]')!);
    expect(keys(host)).toEqual(['person-tile-movie-11', 'person-tile-tv-12', 'person-tile-movie-10']);
  });

  it('shows the «Обзор ›» label above the name', async () => {
    const host = await mount();
    expect(text(host.querySelector('.person-crumb'))).toBe('Обзор ›');
  });

  it('the job label follows the selected job', async () => {
    stub.person = vi.fn(() => Promise.resolve({ ...card, directing: [credit('movie', 30, 'Режиссура', 2019)] }));
    const host = await mount();
    expect(text(host.querySelector('.person-job'))).toBe('Актёр');
    await click(host.querySelector('[data-fk="person-job-directing"]')!);
    expect(text(host.querySelector('.person-job'))).toBe('Режиссёр');
  });

  describe('biography', () => {
    const long = 'Родился в маленьком городе. '.repeat(20);
    it('no bio, no block', async () => {
      const host = await mount();
      expect(host.querySelector('.person-bio')).toBeNull();
      expect(host.querySelector('[data-fk="person-bio-more"]')).toBeNull();
    });
    it('a short bio is shown with no «Ещё»', async () => {
      stub.person = vi.fn(() => Promise.resolve({ ...card, bio: 'Коротко о нём.' }));
      const host = await mount();
      expect(text(host.querySelector('.person-bio'))).toBe('Коротко о нём.');
      expect(host.querySelector('[data-fk="person-bio-more"]')).toBeNull();
    });
    it('a long bio is clamped; «Ещё» opens the dialog with the full text', async () => {
      stub.person = vi.fn(() => Promise.resolve({ ...card, bio: long }));
      const host = await mount();
      expect(host.querySelector('.person-bio')).not.toBeNull();
      const more = host.querySelector('[data-fk="person-bio-more"]')!;
      expect(text(more)).toBe('Ещё');
      const { DialogHost } = await import('../../src/ui/dialog');
      const dh = document.createElement('div');
      hosts.push(dh);
      document.body.appendChild(dh);
      act(() => { render(h(DialogHost as any, {}), dh); });
      await click(more);
      expect(text(document.querySelector('.dialog-title'))).toContain('Родился в маленьком городе.');
      expect(text(document.querySelector('.dialog-title')).length).toBeGreaterThan(300);
    });
  });

  it('shows the job chips only when the person has both', async () => {
    let host = await mount();
    expect(host.querySelector('[data-fk="person-job-acting"]')).toBeNull();
    stub.person = vi.fn(() => Promise.resolve({ ...card, known: 'directing', directing: [credit('movie', 30, 'Режиссура', 2019)] }));
    host = await mount();
    expect(host.querySelector('[data-fk="person-job-directing"]')).not.toBeNull();
    expect(text(host.querySelector('.person-job'))).toBe('Режиссёр');
    expect(keys(host)).toEqual(['person-tile-movie-30']);
    await click(host.querySelector('[data-fk="person-job-acting"]')!);
    expect(keys(host)).toHaveLength(3);
  });

  it('the yellow key toggles the want list', async () => {
    const host = await mount();
    await act(() => { setFocus('person-tile-movie-11'); });
    await flush();
    await act(() => { dispatchKey('yellow', new KeyboardEvent('keydown')); });
    await flush();
    expect(wantList.value.map((w) => w.id)).toEqual([11]);
    expect(text(host.querySelector('[data-fk="person-tile-movie-11"] .disc-mark'))).toBe('Хочу');
  });

  it('shows the offline text with «Повторить»', async () => {
    stub.person = vi.fn(() => Promise.reject(Object.assign(new Error('offline'), { code: 'offline' })));
    const host = await mount();
    expect(text(host.querySelector('.disc-error'))).toContain('TMDB не отвечает');
    stub.person = vi.fn(() => Promise.resolve(card));
    await click(host.querySelector('[data-fk="person-retry"]')!);
    expect(text(host.querySelector('.person-name'))).toBe('Иван Режиссёров');
  });

  it('a person with no credits focuses «Все»', async () => {
    stub.person = vi.fn(() => Promise.resolve({ ...card, acting: [] }));
    await mount();
    expect(getCurrentFocusKey()).toBe('person-filter-all');
  });
});

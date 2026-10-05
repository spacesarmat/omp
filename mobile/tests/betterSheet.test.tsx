import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../src/store/journal', async (orig) => ({
  ...(await orig<typeof import('../../src/store/journal')>()),
  loadSkip: vi.fn(async () => ({ i: false, c: false })),
  loadWatch: vi.fn(async () => true),
  loadQualityWatch: vi.fn(async () => true),
}));
vi.mock('../../src/monitor/replace', async (orig) => ({
  ...(await orig<typeof import('../../src/monitor/replace')>()),
  replaceWithResult: vi.fn(),
}));

import { applyLanguageSetting } from '../../src/i18n';
import { Torrent } from '../src/screens/Torrent';
import { currentRoute, navigate, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { fakeMonitor, type FakeMonitor } from './fakeMonitor';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrents } from '../../src/store/library';
import { getLocalProgress, reloadProgress, saveProgress, serverViewed } from '../../src/store/progress';
import { replaceWithResult } from '../../src/monitor/replace';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth, setSourceOn } from '../../src/sources/store';
import type { SourceResult } from '../../src/sources/types';
import type { Torrent as T } from '../../src/api/types';

const OLD = 'b'.repeat(40);
const NEW = 'c'.repeat(40);
let el: HTMLElement;
let mon: FakeMonitor;
let found: () => Promise<SourceResult[]>;
const replaceMock = replaceWithResult as unknown as ReturnType<typeof vi.fn>;

function row(p: Partial<SourceResult>): SourceResult {
  return { Title: 'Северный ветер (2026) 2160p WEB-DL', Categories: '', Size: '18,2 ГБ', CreateDate: '', Tracker: '', Link: '', Magnet: 'magnet:?xt=urn:btih:' + NEW, Hash: NEW, Peer: 0, Seed: 940, source: 'fake', ...p };
}

const film: T = { hash: OLD, title: 'Северный ветер (2026) WEB-DL 1080p', category: 'movie', stat: 3, torrent_size: 9 * 1024 ** 3, file_stats: [{ id: 1, path: 'North.Wind.2026.mkv', length: 9e9 }] } as T;
const show: T = {
  hash: OLD,
  title: 'Дом дракона [S02E01-03 из 08] (2024) WEB-DL 1080p',
  category: 'tv',
  stat: 3,
  file_stats: [1, 2, 3].map((i) => ({ id: i, path: 'HotD.S02E0' + i + '.1080p.mkv', length: 1e9 })),
} as T;

const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
const byText = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t);
const click = (n: Element | undefined | null) => {
  if (!n) throw new Error('missing element');
  act(() => (n as HTMLElement).click());
};

async function mountTorrent(t: T) {
  if (el) act(() => render(null, el));
  torrents.value = [t];
  resetTo({ name: 'library' });
  navigate({ name: 'torrent', hash: t.hash });
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => render(<Torrent hash={t.hash} /> as ComponentChild, el));
  await flush();
}

async function openBetter() {
  click(el.querySelector('[data-block="find-better"]'));
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  reloadProgress();
  serverViewed.value = [];
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  setSourceOn('ts-rutor', false);
  setSourceOn('ts-torznab', false);
  found = () => Promise.resolve([]);
  registerSource({ id: 'fake', name: 'rutor', kind: 'builtin', search: () => found() });
  toast.value = '';
  replaceMock.mockReset();
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue({ streams: [] });
  mon = fakeMonitor();
});

afterEach(() => {
  act(() => render(null, el));
  unregisterSource('fake');
  mon.restore();
  vi.restoreAllMocks();
  applyLanguageSetting('ru');
});

describe('«Найти в лучшем качестве» · film', () => {
  it('lists the better releases best first; the same quality is left out', async () => {
    found = () =>
      Promise.resolve([
        row({ Title: 'Северный ветер (2026) WEB-DL 1080p', Seed: 999, Hash: 'd'.repeat(40), Magnet: 'magnet:?xt=urn:btih:' + 'd'.repeat(40) }),
        row({ Title: 'Северный ветер (2026) BDRip 1080p', Seed: 40, Hash: 'e'.repeat(40), Magnet: 'magnet:?xt=urn:btih:' + 'e'.repeat(40) }),
        row({}),
      ]);
    await mountTorrent(film);
    await openBetter();
    const rows = Array.from(el.querySelectorAll('[data-better-row]'));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('4K');
    expect(rows[0].textContent).toContain('18,2 ГБ');
    expect(rows[0].textContent).toContain('rutor');
    expect(rows[1].textContent).toContain('BDRip');
    expect(el.textContent).toContain('У вас: 1080p WEB-DL');
  });

  it('«Ищу…» with «Отмена» while the sources search', async () => {
    found = () => new Promise<SourceResult[]>(() => {});
    await mountTorrent(film);
    await openBetter();
    expect(el.querySelector('[data-block="better-searching"]')!.textContent).toContain('Ищу…');
    click(el.querySelector('[data-block="better-searching"] button'));
    await flush();
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('nothing better: says so, «Искать все раздачи» opens «Добавить» with the query', async () => {
    found = () => Promise.resolve([row({ Title: 'Северный ветер (2026) WEB-DL 720p' })]);
    await mountTorrent(film);
    await openBetter();
    expect(el.textContent).toContain('Лучше вашей раздачи ничего не нашлось');
    click(byText('Искать все раздачи'));
    expect(currentRoute.value).toEqual({ name: 'add', query: 'Северный ветер 2026', run: true });
  });

  it('«Заменить» confirms old → new quality and runs the replace with the chosen release', async () => {
    found = () => Promise.resolve([row({})]);
    replaceMock.mockResolvedValue({ ok: true, hash: NEW });
    vi.spyOn(TorrServerClient.prototype, 'loadInfo').mockResolvedValue({ hash: NEW, file_stats: [{ id: 1, path: 'North.Wind.2026.2160p.mkv', length: 1 }] } as T);
    await mountTorrent(film);
    await openBetter();
    click(el.querySelector('[data-better-row] .m-btn-primary'));
    await flush();
    expect(el.querySelector('[data-block="better-change"]')!.textContent).toBe('1080p WEB-DL → 4K WEB-DL');
    expect(replaceMock).not.toHaveBeenCalled();
    click(byText('Заменить'));
    await flush();
    expect(replaceMock.mock.calls[0][1]).toBe(OLD);
    expect(replaceMock.mock.calls[0][2].Title).toBe('Северный ветер (2026) 2160p WEB-DL');
    expect(toast.value).toContain('Заменено');
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: NEW });
  });
});

describe('«Найти в лучшем качестве» · series', () => {
  it('same season covering our episodes only; positions move by episode', async () => {
    found = () =>
      Promise.resolve([
        row({ Title: 'Дом дракона [S02E01-08 из 08] (2024) WEB-DL 2160p' }),
        row({ Title: 'Дом дракона [S02E04-08 из 08] (2024) WEB-DL 2160p', Hash: 'd'.repeat(40) }),
        row({ Title: 'Дом дракона [S01E01-10 из 10] (2022) WEB-DL 2160p', Hash: 'e'.repeat(40) }),
      ]);
    replaceMock.mockResolvedValue({ ok: true, hash: NEW });
    saveProgress(OLD, 2, 700, 3000);
    await mountTorrent(show);
    await openBetter();
    const rows = Array.from(el.querySelectorAll('[data-better-row]'));
    expect(rows.length).toBe(1);
    // the new release has a sample first: E02 is file 3 there
    vi.spyOn(TorrServerClient.prototype, 'loadInfo').mockResolvedValue({
      hash: NEW,
      file_stats: [{ id: 1, path: 'sample.mkv', length: 1 }].concat([1, 2, 3, 4].map((i) => ({ id: i + 1, path: 'HotD.S02E0' + i + '.2160p.mkv', length: 1e9 }))),
    } as T);
    click(rows[0].querySelector('.m-btn-primary'));
    await flush();
    click(byText('Заменить'));
    await flush();
    expect(replaceMock).toHaveBeenCalled();
    expect(getLocalProgress(NEW, 3)!.time).toBe(700);
    expect(getLocalProgress(OLD, 2)).toBe(null);
  });
});

describe('«Найти в лучшем качестве» · few seeds, packs, failures, cancel', () => {
  const pickFirst = async () => {
    click(el.querySelector('[data-better-row] .m-btn-primary'));
    await flush();
  };

  it('few seeds: last, with a chip; choosing it warns before the replace', async () => {
    found = () =>
      Promise.resolve([
        row({ Title: 'Северный ветер (2026) 2160p Remux', Seed: 2, Hash: 'd'.repeat(40), Magnet: 'magnet:?xt=urn:btih:' + 'd'.repeat(40) }),
        row({ Title: 'Северный ветер (2026) BDRip 1080p', Seed: 50 }),
      ]);
    await mountTorrent(film);
    await openBetter();
    const rows = Array.from(el.querySelectorAll('[data-better-row]'));
    expect(rows[0].textContent).toContain('BDRip');
    expect(rows[0].querySelector('[data-low-seeds]')).toBeNull();
    expect(rows[1].querySelector('[data-low-seeds]')!.textContent).toBe('мало сидов');
    click(rows[1].querySelector('.m-btn-primary'));
    await flush();
    expect(el.querySelector('[data-block="low-seeds"]')!.textContent).toBe('У раздачи мало сидов — получить её может не получиться');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('a pack of more seasons says so in its row', async () => {
    found = () => Promise.resolve([row({ Title: 'Дом дракона (2024) Сезоны 1-3 WEB-DL 2160p' })]);
    await mountTorrent(show);
    await openBetter();
    expect(el.querySelector('[data-better-row]')!.textContent).toContain('сезоны 1–3');
  });

  it('a timeout: says why, the list stays for another pick', async () => {
    found = () => Promise.resolve([row({})]);
    replaceMock.mockResolvedValue({ ok: false, error: 'x', cause: 'timeout' });
    await mountTorrent(film);
    await openBetter();
    await pickFirst();
    click(byText('Заменить'));
    await flush();
    expect(el.querySelector('[data-block="better-failure"]')!.textContent).toBe(
      'Не удалось получить раздачу: TorrServer не дождался данных — возможно, мало сидов. Ваша раздача не тронута.',
    );
    expect(el.querySelectorAll('[data-better-row]').length).toBe(1);
  });

  it('a site that wants a login: names it, «Войти» opens its page', async () => {
    found = () => Promise.resolve([row({})]);
    registerSource({ id: 'locked', name: 'Kinozal', kind: 'builtin', search: () => Promise.resolve([]), login: () => Promise.resolve() } as never);
    replaceMock.mockImplementation(async () => ({ ok: false, error: 'x', cause: 'login' }));
    try {
      found = () => Promise.resolve([row({ source: 'locked' })]);
      await mountTorrent(film);
      await openBetter();
      await pickFirst();
      click(byText('Заменить'));
      await flush();
      const fail = el.querySelector('[data-block="better-failure"]')!;
      expect(fail.textContent).toContain('Сайт не отдал раздачу — нужен вход в Kinozal. Ваша раздача не тронута.');
      click(Array.from(fail.querySelectorAll('button')).find((b) => b.textContent === 'Войти'));
      expect(currentRoute.value).toEqual({ name: 'sourceSite', id: 'locked' });
    } finally {
      unregisterSource('locked');
    }
  });

  it('anything else: the error plus «Ваша раздача не тронута.»', async () => {
    found = () => Promise.resolve([row({})]);
    replaceMock.mockResolvedValue({ ok: false, error: 'Сервер недоступен.', cause: 'other' });
    await mountTorrent(film);
    await openBetter();
    await pickFirst();
    click(byText('Заменить'));
    await flush();
    expect(el.querySelector('[data-block="better-failure"]')!.textContent).toBe('Сервер недоступен. Ваша раздача не тронута.');
  });

  it('«Отмена» stays enabled during the replace and stops it with a 45 s cap', async () => {
    found = () => Promise.resolve([row({})]);
    replaceMock.mockImplementation(
      (_c: unknown, _h: string, _r: unknown, _ctx: unknown, o: { abort: { onAbort(fn: () => void): void }; deadlineMs: number }) =>
        new Promise((resolve) => o.abort.onAbort(() => resolve({ ok: false, error: 'x', cause: 'cancelled' }))),
    );
    await mountTorrent(film);
    await openBetter();
    await pickFirst();
    click(byText('Заменить'));
    await flush();
    expect(el.textContent).toContain('Заменяю…');
    expect(replaceMock.mock.calls[0][4].deadlineMs).toBe(45000);
    const cancel = el.querySelector('[data-action="cancel-replace"]') as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    click(cancel);
    await flush();
    expect(el.textContent).not.toContain('Заменяю…');
    expect(el.querySelector('[data-block="better-failure"]')).toBeNull();
    expect(el.querySelectorAll('[data-better-row]').length).toBe(1);
  });
});

describe('«Найти в лучшем качестве» in English', () => {
  it('the warnings and the failures have no Russian', async () => {
    applyLanguageSetting('en');
    const en: T = { ...film, title: 'North Wind (2026) WEB-DL 1080p' } as T;
    found = () => Promise.resolve([row({ Title: 'North Wind (2026) 2160p Remux', Seed: 2, Size: '18.2 GB' })]);
    replaceMock.mockResolvedValue({ ok: false, error: 'x', cause: 'timeout' });
    await mountTorrent(en);
    await openBetter();
    expect(el.querySelector('[data-low-seeds]')!.textContent).toBe('few seeds');
    click(el.querySelector('[data-better-row] .m-btn-primary'));
    await flush();
    expect(el.querySelector('[data-block="low-seeds"]')!.textContent).toBe('This release has few seeds — getting it may not work');
    click(byText('Replace'));
    await flush();
    const fail = el.querySelector('[data-block="better-failure"]')!.textContent!;
    expect(fail).toContain('Your release is untouched.');
    expect(el.querySelector('[role=dialog]')!.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });
});

describe('«Найти в лучшем качестве» in English', () => {
  beforeEach(() => applyLanguageSetting('en'));

  it('the button, the list and the empty state have no Russian', async () => {
    const en: T = { ...film, title: 'North Wind (2026) WEB-DL 1080p' } as T;
    found = () => Promise.resolve([row({ Title: 'North Wind (2026) 2160p Remux', Size: '40 GB' })]);
    await mountTorrent(en);
    expect(el.querySelector('[data-block="find-better"]')!.textContent).toBe('Find in better quality');
    await openBetter();
    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.textContent).toContain('You have: 1080p WEB-DL');
    expect(dialog.textContent).toContain('Replace');
    expect(dialog.textContent).not.toMatch(/[А-Яа-яЁё]/);
    click(el.querySelector('[data-better-row] .m-btn-primary'));
    await flush();
    expect(el.querySelector('[role=dialog]')!.textContent).not.toMatch(/[А-Яа-яЁё]/);
    found = () => Promise.resolve([]);
    await mountTorrent(en);
    await openBetter();
    expect(el.textContent).toContain('Nothing better than your release was found');
    expect(byText('Search all releases')).toBeTruthy();
  });
});

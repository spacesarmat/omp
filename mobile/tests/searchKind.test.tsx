// Phone search: the kind badge of each result, the «Все / Фильмы / Сериалы» filter and «Смотреть на телефоне».
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Add, resetAddSearch } from '../src/screens/Add';
import { setWatchActions } from '../src/watch';
import { currentRoute, resetTo } from '../src/nav';
import { reloadTvs } from '../src/tv/tvStore';
import { toast } from '../src/ui/toast';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrents } from '../../src/store/library';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { setKindFilter } from '../../src/lib/releaseKind';
import { settings, updateSettings } from '../../src/store/settings';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

const HASH = 'a'.repeat(40);
const FILM = 'Дюна / Dune (2021) BDRip 1080p';
const SERIES = 'Дюна: Пророчество / Dune: Prophecy / Сезон: 1 / Серии: 1-6 из 6 [2024, WEB-DL 1080p]';
const BARE = 'Dune 1080p WEB-DL';
const row = (Title: string, n: string, Seed: number) => ({
  Title,
  Categories: '',
  Size: '10 GB',
  CreateDate: '',
  Tracker: 'rutor',
  Link: '',
  Magnet: 'magnet:?xt=urn:btih:' + n.repeat(40),
  Hash: n.repeat(40),
  Peer: 1,
  Seed,
});
const results = [row(FILM, 'a', 30), row(SERIES, 'b', 20), row(BARE, 'c', 10)];

let el: HTMLElement;
const openExternal = vi.fn();

function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Add />, el));
}

const click = (n: Element) => act(() => (n as HTMLElement).click());
const titles = () => Array.from(el.querySelectorAll('.m-result')).map((n) => n.getAttribute('data-title'));
const card = (title: string) => Array.from(el.querySelectorAll('.m-result')).find((n) => n.getAttribute('data-title') === title)!;
const badge = (title: string) => {
  const b = card(title).querySelector('[data-kind-badge]');
  return b ? b.textContent : null;
};
const kindButton = (label: string) => Array.from(el.querySelectorAll('[data-kind-filter] button')).find((b) => b.textContent === label)!;
const phoneButton = (title: string) => card(title).querySelector('[aria-label^="Добавить и смотреть на телефоне"]') as HTMLButtonElement;

async function search(q: string) {
  const i = el.querySelector('input[aria-label="Поиск по источникам"]') as HTMLInputElement;
  act(() => {
    i.value = q;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  resetAddSearch();
  reloadTvs();
  setKindFilter('all');
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  toast.value = '';
  openExternal.mockReset().mockResolvedValue(undefined);
  setWatchActions({ openExternal, recordWatch: vi.fn().mockResolvedValue(undefined), phoneName: async () => 'Pixel', remoteDelayMs: 0 });
  resetTo({ name: 'add' });
  torrents.value = [];
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  // rutor answers, torznab finds nothing
  vi.spyOn(TorrServerClient.prototype, 'search').mockImplementation((_q, src) => Promise.resolve(src === 'rutor' ? results : []));
});

afterEach(() => {
  if (el) act(() => render(null, el));
  vi.restoreAllMocks();
  setWatchActions(null);
  setKindFilter('all');
});

describe('phone search: kind badge and filter', () => {
  it('a badge per result with the known parts; none for an unknown kind', async () => {
    mount();
    await search('dune');
    expect(badge(FILM)).toBe('Фильм');
    expect(badge(SERIES)).toBe('Сериал · S01 · 1–6 из 6');
    expect(badge(BARE)).toBeNull();
    // the details sheet shows it too
    click(card(SERIES).querySelector('.m-rc-open')!);
    expect(el.querySelector('[data-result-details] [data-kind-badge]')!.textContent).toBe('Сериал · S01 · 1–6 из 6');
  });

  it('«Все / Фильмы / Сериалы» filters the results, the unknown kind only under «Все»; kept for the session', async () => {
    mount();
    await search('dune');
    expect(Array.from(el.querySelectorAll('[data-kind-filter] button')).map((b) => b.textContent)).toEqual(['Все', 'Фильмы', 'Сериалы']);
    expect(kindButton('Все').getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toEqual([FILM, SERIES, BARE]);
    click(kindButton('Сериалы'));
    expect(titles()).toEqual([SERIES]);
    expect(kindButton('Сериалы').className).toContain('on');
    click(kindButton('Фильмы'));
    expect(titles()).toEqual([FILM]);
    expect(el.querySelector('[data-search-progress]')!.textContent).toContain('Найдено 1');
    // another screen and back: still «Фильмы»
    act(() => render(null, el));
    mount();
    await flush();
    expect(kindButton('Фильмы').getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toEqual([FILM]);
  });

  it('nothing of the chosen kind: says so, not «Ничего не найдено»', async () => {
    vi.spyOn(TorrServerClient.prototype, 'search').mockImplementation((_q, src) => Promise.resolve(src === 'rutor' ? [row(FILM, 'a', 3)] : []));
    mount();
    await search('dune');
    click(kindButton('Сериалы'));
    expect(titles()).toEqual([]);
    expect(el.querySelector('[data-empty]')!.textContent).toBe('Нет раздач этого типа — выберите «Все»');
  });
});

describe('phone search: «Смотреть на телефоне»', () => {
  const file = (id: number, path: string) => ({ id, path, length: 1000 });

  it('adds the release and plays its one file on the phone (the system chooser by default)', async () => {
    const add = vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue({ hash: HASH, file_stats: [file(1, 'Dune.2021.mkv'), file(2, 'Dune.srt')] } as any);
    const loadInfo = vi.spyOn(TorrServerClient.prototype, 'loadInfo');
    expect(settings.value.videoPlayer).toBe('builtin');
    mount();
    await search('dune');
    click(phoneButton(FILM));
    await flush();
    expect(add).toHaveBeenCalledWith({ link: 'magnet:?xt=urn:btih:' + HASH, title: FILM, category: 'movie' });
    expect(loadInfo).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal.mock.calls[0][0]).toBe('http://srv:8090/stream/Dune.2021.mkv?link=' + HASH + '&index=1&play');
    expect(openExternal.mock.calls[0][1]).toBe('video/*');
    expect(currentRoute.value).toEqual({ name: 'add' });
  });

  it('waits for the files when TorrServer has no metadata yet, and respects the 2160 Player setting', async () => {
    const open2160 = vi.fn().mockResolvedValue({ returned: false });
    setWatchActions({ openExternal, open2160, player2160: async () => 'com.spacesarmat.player2160', recordWatch: vi.fn().mockResolvedValue(undefined), phoneName: async () => 'Pixel' });
    updateSettings({ videoPlayer: 'p2160' });
    try {
      vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
      vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue({ hash: HASH } as any);
      const loadInfo = vi.spyOn(TorrServerClient.prototype, 'loadInfo').mockResolvedValue({ hash: HASH, file_stats: [file(0, 'Dune.mkv')] } as any);
      mount();
      await search('dune');
      click(phoneButton(FILM));
      await flush();
      await flush();
      expect(loadInfo).toHaveBeenCalledWith(HASH);
      expect(openExternal).not.toHaveBeenCalled();
      expect(open2160).toHaveBeenCalledTimes(1);
    } finally {
      updateSettings({ videoPlayer: 'builtin' });
    }
  });

  it('several playable files (a series): the torrent screen opens to choose, nothing plays', async () => {
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: 'b'.repeat(40) } as any);
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue({
      hash: 'b'.repeat(40),
      file_stats: [file(1, 'Prophecy.S01E01.mkv'), file(2, 'Prophecy.S01E02.mkv')],
    } as any);
    mount();
    await search('dune');
    // also in the card's details sheet
    click(card(SERIES).querySelector('.m-rc-open')!);
    click(Array.from(el.querySelectorAll('.m-sheet-row button')).find((b) => b.textContent === 'На телефоне')!);
    await flush();
    expect(openExternal).not.toHaveBeenCalled();
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'b'.repeat(40) });
  });

  it('an error is shown under the search like the TV path; the row is free again', async () => {
    vi.spyOn(TorrServerClient.prototype, 'add').mockResolvedValue({ hash: HASH } as any);
    vi.spyOn(TorrServerClient.prototype, 'get').mockRejectedValue(new Error('Сервер не ответил'));
    mount();
    await search('dune');
    click(phoneButton(FILM));
    await flush();
    expect(el.querySelector('.m-error')!.textContent).toContain('Сервер не ответил');
    expect(openExternal).not.toHaveBeenCalled();
    expect(phoneButton(FILM).disabled).toBe(false);
  });
});

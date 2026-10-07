import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../src/store/journal', async (orig) => ({
  ...(await orig<typeof import('../../src/store/journal')>()),
  loadSkip: vi.fn(async () => ({ i: false, c: false })),
  loadWatch: vi.fn(),
  saveWatch: vi.fn(),
}));

import { applyLanguageSetting } from '../../src/i18n';
import { Torrent } from '../src/screens/Torrent';
import { resetTo, navigate } from '../src/nav';
import { toast } from '../src/ui/toast';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { setWatchActions } from '../src/watch';
import { settings, updateSettings } from '../../src/store/settings';
import { getLocalProgress } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
import { loadWatch, saveWatch } from '../../src/store/journal';
import { addFindings, findingsOf } from '../../src/monitor/subs';
import type { Torrent as T } from '../../src/api/types';

const HASH = 'a'.repeat(40);
const series: T = {
  hash: HASH,
  title: 'Starbound Frontier S02 1080p WEB-DL',
  category: 'tv',
  stat: 3,
  file_stats: [1, 2].map((i) => ({ id: i, path: 'Show.S02E0' + i + '.mkv', length: 1e9 })),
};
const loadMock = loadWatch as unknown as ReturnType<typeof vi.fn>;
const saveMock = saveWatch as unknown as ReturnType<typeof vi.fn>;
let el: HTMLElement;

const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
const sw = () => el.querySelector('[role=switch][aria-label="Следить за новыми сериями"]') as HTMLElement | null;
const click = (n: Element | null) => {
  if (!n) throw new Error('missing element');
  act(() => { (n as HTMLElement).click(); });
};

async function mount(t: T) {
  torrents.value = [t];
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => { render(<Torrent hash={t.hash} />, el); });
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  serverViewed.value = [];
  toast.value = '';
  loadMock.mockReset().mockResolvedValue(true);
  saveMock.mockReset();
  resetTo({ name: 'library' });
  navigate({ name: 'torrent', hash: HASH });
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue({ streams: [] });
});
afterEach(() => {
  act(() => render(null, el));
  vi.restoreAllMocks();
});

describe('phone torrent card · «Следить за новыми сериями»', () => {
  it('a series shows the switch with the saved value', async () => {
    loadMock.mockResolvedValue(false);
    await mount(series);
    expect(loadMock.mock.calls[0][1]).toBe(HASH);
    expect(sw()!.getAttribute('aria-checked')).toBe('false');
  });

  it('a film has no switch', async () => {
    await mount({ ...series, title: 'Ночной рейс (2026) BDRip 1080p', category: 'movie', file_stats: [{ id: 1, path: 'film.mkv', length: 1e9 }] });
    expect(sw()).toBeNull();
  });

  it('switching off saves omp.w and drops the series\' new-episodes card', async () => {
    addFindings([
      {
        subId: 'episodes',
        key: HASH + ':2:10',
        at: 1,
        result: { Title: 'x S02E01-10', Categories: '', Size: '', CreateDate: '', Tracker: '', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 0, source: 'r' },
        episodes: { torrentHash: HASH, torrentTitle: series.title!, season: 2, haveTo: 2, to: 10 },
      },
    ]);
    saveMock.mockResolvedValue(false);
    await mount(series);
    click(sw());
    expect(sw()!.getAttribute('aria-checked')).toBe('false');
    expect(saveMock.mock.calls[0][2]).toBe(false);
    await flush();
    expect(findingsOf('episodes')).toEqual([]);
  });

  it('a failed write puts the switch back', async () => {
    saveMock.mockRejectedValue(new Error('Сервер недоступен'));
    await mount(series);
    click(sw());
    await flush();
    expect(sw()!.getAttribute('aria-checked')).toBe('true');
    expect(toast.value).toBe('Сервер недоступен');
  });
});

describe('phone torrent card · one «Мониторинг» card', () => {
  const card = () => el.querySelector('[data-block=monitoring]');
  const film = { ...series, title: 'Ночной рейс (2026) BDRip 1080p', category: 'movie', file_stats: [{ id: 1, path: 'film.mkv', length: 1e9 }] };

  it('a series: the card has only the episodes row, no subtitles', async () => {
    await mount(series);
    expect(card()!.querySelector('.m-skip-title')!.textContent).toBe('Мониторинг');
    expect(card()!.querySelectorAll('[role=switch]').length).toBe(1);
    expect(card()!.querySelector('[aria-label="Следить за новыми сериями"]')).toBeTruthy();
    expect(card()!.textContent).not.toContain('сообщить');
    expect(el.querySelectorAll('[data-block=monitoring]').length).toBe(1);
  });

  it('a film: the card has only the quality row', async () => {
    await mount(film);
    expect(card()!.querySelectorAll('[role=switch]').length).toBe(1);
    expect(card()!.querySelector('[aria-label="Следить за качеством"]')).toBeTruthy();
    expect(card()!.textContent).not.toContain('сообщить');
  });

  it('English render of the card', async () => {
    applyLanguageSetting('en');
    try {
      await mount(film);
      expect(card()!.querySelector('.m-skip-title')!.textContent).toBe('Monitoring');
      expect(card()!.textContent).toContain('Watch the quality');
      expect(card()!.textContent).not.toMatch(/[А-Яа-яЁё]/);
    } finally {
      applyLanguageSetting('ru');
    }
  });
});

describe('phone torrent card · «Смотреть на телефоне»', () => {
  const open2160 = vi.fn();
  const openExternal = vi.fn();
  const player2160 = vi.fn();
  const byText = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes(t));
  beforeEach(() => {
    localStorage.setItem('tsp.ui.skipOpen', 'true');
    open2160.mockReset().mockResolvedValue({ returned: false });
    openExternal.mockReset().mockResolvedValue(undefined);
    player2160.mockReset().mockResolvedValue('com.spacesarmat.player2160');
    setWatchActions({ open2160, openExternal, player2160, recordWatch: vi.fn().mockResolvedValue(undefined), phoneName: async () => 'Pixel' });
    updateSettings({ videoPlayer: 'p2160' });
  });
  afterEach(() => {
    setWatchActions(null);
    updateSettings({ videoPlayer: 'builtin' });
  });

  it('with 2160 Player: all playable files, the start index, and where the user stopped is saved', async () => {
    const url = (i: number) => 'http://srv:8090/stream/Show.S02E0' + i + '.mkv?link=' + HASH + '&index=' + i + '&play';
    open2160.mockResolvedValue({ returned: true, positionMs: 600000, durationMs: 2400000, url: url(2) });
    await mount(series);
    click(byText('Смотреть на телефоне') as Element);
    await flush();
    expect(openExternal).not.toHaveBeenCalled();
    expect(open2160).toHaveBeenCalledTimes(1);
    const o = open2160.mock.calls[0][0];
    expect(o.items.map((i: { url: string }) => i.url)).toEqual([url(1), url(2)]);
    expect(o.start).toBe(0);
    expect(o.fromStart).toBe(true);
    expect(getLocalProgress(HASH, 2)).toMatchObject({ time: 600, duration: 2400 });
    expect(getLocalProgress(HASH, 1)).toBeNull();
  });

  it('with the setting off the system chooser opens as before', async () => {
    updateSettings({ videoPlayer: 'builtin' });
    await mount(series);
    click(byText('Смотреть на телефоне') as Element);
    await flush();
    expect(open2160).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal.mock.calls[0][1]).toBe('video/*');
  });

  it('2160 Player not installed: falls back to the chooser', async () => {
    player2160.mockResolvedValue(null);
    await mount(series);
    click(byText('Смотреть на телефоне') as Element);
    await flush();
    expect(open2160).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(settings.value.videoPlayer).toBe('p2160');
  });
});

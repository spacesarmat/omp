// Clean names of what plays: «Сейчас на ТВ» and the «Откуда смотреть?» label never show a file name or a raw
// tracker title; the TMDB show and episode names when known.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { NowPlaying } from '../src/screens/NowPlaying';
import { nowPlaying, lastSeen, setPlayerLinkDeps } from '../src/tv/playerLink';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { setCatalogClientForTests } from '../src/catalog/phoneCatalog';
import { resetEpisodeNames } from '../src/lib/episodeNames';
import { matchSeries, resetSeriesMatches } from '../src/lib/seriesMatch';
import { singleGroup } from '../src/lib/seriesGroups';
import { episodeLine, launchLabel, looksLikeName } from '../src/lib/playingNames';
import { miniTitle } from '../src/ui/MiniPlayer';
import { torrents } from '../../src/store/library';
import type { Torrent } from '../../src/api/types';
import type { PlayerState } from '../../src/phone/protocol';

const DARK: Torrent = {
  hash: 'dm',
  title: 'Темная материя / Dark Matter / Сезон: 2 / Серии: 1-6 из 10 (Алик Сахаров) [2024, США, WEB-DL 1080p]',
  category: 'tv',
  stat: 3,
  torrent_size: 1,
  file_stats: [
    { id: 1, path: 'Dark.Matter.S02E01.1080p.WEB-DL.RGzsRutracker.mkv', length: 1 },
    { id: 2, path: 'Dark.Matter.S02E02.1080p.WEB-DL.RGzsRutracker.mkv', length: 1 },
  ],
} as Torrent;
const FILM: Torrent = { hash: 'qs', title: 'Тихий сигнал / Quiet Signal (2026) WEB-DL 2160p', category: 'movie', stat: 3, torrent_size: 1, file_stats: [{ id: 1, path: 'Quiet.Signal.2026.2160p.mkv', length: 1 }] } as Torrent;

const SHOW = { kind: 'tv' as const, id: 22, title: 'Тёмная материя', original: 'Dark Matter', year: 2024, poster: '', rating: 0 };
const ep = (n: number, title: string) => ({ n, title, airDate: '', runtime: 0, overview: '' });
function fake() {
  const card = { ...SHOW, backdrop: '', genres: [], runtime: 0, overview: '', cast: [], airing: false, seasons: [{ number: 2, episodes: 10, year: 2025, aired: 10 }] };
  setCatalogClientForTests({
    novelties: vi.fn(),
    discover: vi.fn(),
    search: vi.fn().mockResolvedValue({ items: [SHOW], pages: 1 }),
    card: vi.fn().mockResolvedValue(card),
    season: vi.fn().mockResolvedValue({ number: 2, name: '', airDate: '', overview: '', episodes: [ep(1, 'Спокойная жизнь'), ep(2, 'Эпизод 2')] }),
  } as never);
}

async function flush() {
  for (let r = 0; r < 6; r++) {
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  }
}

const state = (o: Partial<PlayerState>): PlayerState => ({
  hash: 'dm', file: 1, title: 'Dark.Matter.S02E01.1080p.WEB-DL.RGzsRutracker.mkv', subtitle: DARK.title + ' · S02E01',
  time: 10, duration: 100, paused: false, buffering: false, audio: { list: [], sel: 0 }, subs: { list: [], sel: 'off' }, next: null, ...o,
});

let el: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
  resetEpisodeNames();
  resetSeriesMatches();
  torrents.value = [DARK, FILM];
  setPlayerLinkDeps({ now: () => 1000, foregroundAppId: () => Promise.resolve(null), tvFailed: () => false, native: { startPlayerServer: vi.fn(), queuePlayerCommands: vi.fn(), onPlayerMessage: () => () => {} } } as never);
});
afterEach(() => {
  if (el) act(() => render(null, el));
  setCatalogClientForTests(null);
  setPlayerLinkDeps(null);
  nowPlaying.value = null;
});

describe('playing names', () => {
  it('the episode line: the code and a real name only', () => {
    expect(episodeLine('S02E01', 'Спокойная жизнь')).toBe('S02E01 · Спокойная жизнь');
    expect(episodeLine('S02E02', 'Эпизод 2')).toBe('S02E02');
    expect(looksLikeName('Тишина в эфире')).toBe(true);
    expect(looksLikeName('Dark Matter S02E01 1080p WEB-DL RGzsRutracker')).toBe(false);
    expect(looksLikeName('Dark.Matter.mkv')).toBe(false);
  });

  it('the mini player line: the episode name when real, else the code with the series; a film by its name', () => {
    expect(miniTitle({ title: 'Тёмная материя', sub: 'S02E01 · Спокойная жизнь' })).toBe('S02E01 · Спокойная жизнь');
    expect(miniTitle({ title: 'Тёмная материя', sub: 'S02E02' })).toBe('S02E02 · Тёмная материя');
    expect(miniTitle({ title: 'Тихий сигнал', sub: '' })).toBe('Тихий сигнал');
  });

  it('«Откуда смотреть?»: the code at once, then «S02E01 · Спокойная жизнь»; a film by its name; the fallback outside «Мои»', async () => {
    fake();
    const named = vi.fn();
    expect(launchLabel('dm', 1, 'raw', named)).toBe('S02E01');
    await flush();
    expect(named).toHaveBeenCalledWith('S02E01 · Спокойная жизнь');
    const none = vi.fn();
    expect(launchLabel('dm', 2, 'raw', none)).toBe('S02E02');
    await flush();
    // «Эпизод 2» is no name
    expect(none).not.toHaveBeenCalled();
    expect(launchLabel('qs', 1, 'raw')).toBe('Тихий сигнал');
    expect(launchLabel('elsewhere', 1, 'S01E01 · x')).toBe('S01E01 · x');
  });

  it('«Сейчас на ТВ» for a matched series in «Мои»: «Тёмная материя», «S02E01 · Спокойная жизнь»', async () => {
    fake();
    await matchSeries(singleGroup(DARK)!);
    nowPlaying.value = state({});
    lastSeen.value = 1000;
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    act(() => render(<NowPlaying volume={() => Promise.resolve()} />, el));
    await flush();
    expect(el.querySelector('.m-now-title')!.textContent).toBe('Тёмная материя');
    expect(el.querySelector('.m-now-sub')!.textContent).toBe('S02E01 · Спокойная жизнь');
    expect(el.textContent).not.toContain('RGzsRutracker');
  });
});

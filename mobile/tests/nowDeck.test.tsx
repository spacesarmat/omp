import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { NowPlaying } from '../src/screens/NowPlaying';
import { deckPaneAfter, episodeSwipePlays } from '../src/screens/nowDeck';
import { deckPeekToward } from '../src/screens/nowPager';
import { nowPlaying, lastSeen, setPlayerLinkDeps } from '../src/tv/playerLink';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { cancelWarmUp } from '../src/tv/tvClient';
import { torrents } from '../../src/store/library';
import { addServer, setActiveServer } from '../../src/store/servers';
import { setWatchActions } from '../src/watch';
import { resetTo, navigate } from '../src/nav';
import type { PlayerState } from '../../src/phone/protocol';
import type { Torrent } from '../../src/api/types';

const launch = vi.fn(() => Promise.resolve());

function touch(type: string, x: number, y: number, target: Element) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: unknown[]; changedTouches: unknown[] };
  const p = { clientX: x, clientY: y };
  ev.touches = type === 'touchend' || type === 'touchcancel' ? [] : [p];
  ev.changedTouches = [p];
  target.dispatchEvent(ev);
}

function swipe(target: Element, from: [number, number], to: [number, number]) {
  act(() => {
    touch('touchstart', from[0], from[1], target);
    touch('touchmove', to[0], to[1], target);
    touch('touchend', to[0], to[1], target);
  });
}

describe('deck pages', () => {
  it('swipe down opens the remote, swipe up the episodes; the ends stay put', () => {
    expect(deckPaneAfter('now', 200, 400, 800)).toBe('remote');
    expect(deckPaneAfter('now', -200, 400, 800)).toBe('episodes');
    expect(deckPaneAfter('remote', -200, 400, 800)).toBe('now');
    expect(deckPaneAfter('episodes', 200, 400, 800)).toBe('now');
    expect(deckPaneAfter('remote', 200, 400, 800)).toBe('remote');
    expect(deckPaneAfter('episodes', -200, 400, 800)).toBe('episodes');
    expect(deckPaneAfter('now', 40, 400, 800)).toBe('now');
    expect(episodeSwipePlays(-80, 4, 200)).toBe(true);
    expect(episodeSwipePlays(80, 4, 200)).toBe(true);
    expect(episodeSwipePlays(10, 40, 200)).toBe(false);
  });

  it('peek target follows the drag direction', () => {
    expect(deckPeekToward('now', 40)).toBe('remote');
    expect(deckPeekToward('now', -40)).toBe('episodes');
    expect(deckPeekToward('now', 8)).toBeNull();
    expect(deckPeekToward('remote', -40)).toBe('now');
    expect(deckPeekToward('episodes', 40)).toBe('now');
  });
});

describe('NowPlaying swipes', () => {
  let el: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
    reloadTvs();
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    const server = addServer({ url: 'http://192.168.1.8:8090' });
    setActiveServer(server.id);
    torrents.value = [{
      hash: 'h',
      title: 'Ледяной перевал S01',
      file_stats: [
        { id: 1, path: 'Frost.Pass.S01E01.mkv', length: 1000 },
        { id: 2, path: 'Frost.Pass.S01E02.mkv', length: 1000 },
      ],
    } as Torrent];
    launch.mockClear();
    setWatchActions({
      launchOnTv: launch,
      ompVersion: () => Promise.resolve('9.0.0'),
      reportUrl: () => Promise.resolve(null),
      localIpv4: () => Promise.resolve('192.168.1.8'),
      phoneName: () => Promise.resolve('Phone'),
      recordWatch: () => Promise.resolve(),
    });
    setPlayerLinkDeps({
      now: () => 100000,
      foregroundAppId: vi.fn(),
      tvFailed: () => false,
      native: { startPlayerServer: vi.fn(), queuePlayerCommands: vi.fn(), onPlayerMessage: () => () => {} } as any,
    });
    const s: PlayerState = {
      hash: 'h', file: 1, title: 'Ледяной перевал', subtitle: 'S01E01',
      time: 10, duration: 1000, paused: false, buffering: false,
      audio: { list: ['Русский'], sel: 0 }, subs: { list: [], sel: 'off' }, next: null,
    };
    nowPlaying.value = s;
    lastSeen.value = 100000;
    resetTo({ name: 'library' });
    navigate({ name: 'nowPlaying' });
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    document.body.innerHTML = '<div id="app"></div>';
    el = document.getElementById('app')!;
    act(() => render(<NowPlaying />, el));
  });
  afterEach(() => {
    cancelWarmUp();
    setWatchActions(null);
    setPlayerLinkDeps(null);
    torrents.value = [];
    act(() => render(null, el));
    vi.restoreAllMocks();
  });

  const card = () => el.querySelector('.m-now') as HTMLElement;
  const pane = () => el.querySelector('.m-now-deck')!.getAttribute('data-pane');

  it('edge hints never sit over a scrolled card: «Пульт» only at the top, «Серии» at the top and the end', () => {
    const now = el.querySelector('section[data-pane="now"]') as HTMLElement;
    let top = 0;
    // jsdom has no layout: stub the scroll box
    Object.defineProperty(now, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) });
    Object.defineProperty(now, 'clientHeight', { configurable: true, get: () => 800 });
    Object.defineProperty(now, 'scrollHeight', { configurable: true, get: () => 1200 });
    const scrollTo = (y: number) =>
      act(() => {
        now.scrollTop = y;
        now.dispatchEvent(new Event('scroll'));
      });
    expect(el.querySelector('.m-now-edge-top')).not.toBeNull();
    expect(el.querySelector('.m-now-edge-bot')).not.toBeNull();
    scrollTo(120);
    expect(el.querySelector('.m-now-edge-top')).toBeNull();
    expect(el.querySelector('.m-now-edge-bot')).toBeNull();
    scrollTo(400);
    expect(el.querySelector('.m-now-edge-top')).toBeNull();
    expect(el.querySelector('.m-now-edge-bot')).not.toBeNull();
    scrollTo(0);
    expect(el.querySelector('.m-now-edge-top')).not.toBeNull();
    expect(el.querySelector('.m-now-edge-bot')).not.toBeNull();
  });

  it('swipe down reveals the remote from above, swipe up the episodes of the release', async () => {
    expect(pane()).toBe('now');
    expect(el.querySelector('.m-now-edge-top')!.textContent).toContain('Пульт');
    expect(el.querySelector('.m-now-edge-bot')!.textContent).toContain('Серии');
    expect(el.querySelector('[data-pane="remote"]')!.textContent).toBe('');
    swipe(card(), [200, 100], [200, 500]);
    expect(pane()).toBe('remote');
    expect(el.textContent).toContain('Домой');
    swipe(el.querySelector('[data-pane="remote"]')!, [200, 400], [200, 80]);
    expect(pane()).toBe('now');
    swipe(card(), [200, 500], [200, 100]);
    expect(pane()).toBe('episodes');
    const rows = Array.from(el.querySelectorAll('.m-now-ep-title')).map((n) => n.textContent);
    expect(rows).toEqual(['S01E01 · Frost.Pass.S01E01', 'S01E02 · Frost.Pass.S01E02']);
    swipe(el.querySelectorAll('.m-now-ep')[1], [300, 200], [40, 210]);
    await act(async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ file: 2 }));
  });
});

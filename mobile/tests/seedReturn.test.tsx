import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Add, resetAddSearch, resetSearchScope } from '../src/screens/Add';
import { setWatchActions } from '../src/watch';
import { resetTo } from '../src/nav';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrents } from '../../src/store/library';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { reloadTvs } from '../src/tv/tvStore';
import type { SeedMeasure } from '../../src/sources/seedVerify';

const HASH = 'a'.repeat(40);
const MEASURES: SeedMeasure[] = [
  { infohash: HASH, verified: true, live: true, seeders: 12, leechers: 3, seedersMax: 12, seedersMedian: 12, peers: 0, samples: 1, measuredAt: 50 },
];

const gate = vi.hoisted(() => ({
  fire: null as null | (() => void),
  cancelled: 0,
}));

vi.mock('../../src/sources/seedVerify', async () => {
  const actual = await vi.importActual<typeof import('../../src/sources/seedVerify')>('../../src/sources/seedVerify');
  return {
    ...actual,
    watchSeedVerify: (opts: { getPending: () => number; onApply: (list: SeedMeasure[]) => void }) => ({
      notify() {
        if (opts.getPending() > 0) return;
        gate.fire = () => opts.onApply(MEASURES);
      },
      cancel() {
        gate.cancelled += 1;
        gate.fire = null;
      },
    }),
  };
});

const ROW = { Title: 'Starbound Frontier', Categories: '', Size: '18 GB', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: 'magnet:?xt=urn:btih:' + HASH, Hash: HASH, Peer: 1, Seed: 4 };

let el: HTMLElement;

function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Add />, el));
}

function unmount() {
  act(() => render(null, el));
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

async function search() {
  const input = el.querySelector('input[aria-label="Поиск по источникам"]') as HTMLInputElement;
  act(() => {
    input.value = 'starbound';
    input.dispatchEvent(new Event('input', { bubbles: true }));
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
  resetSearchScope();
  reloadTvs();
  gate.fire = null;
  gate.cancelled = 0;
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  setWatchActions({ ompVersion: async () => null, reportUrl: async () => null, launchOnTv: async () => undefined, remoteDelayMs: 0 });
  resetTo({ name: 'add' });
  torrents.value = [];
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  vi.spyOn(TorrServerClient.prototype, 'search').mockResolvedValue([ROW]);
});

afterEach(() => {
  if (el) unmount();
  resetAddSearch();
  vi.restoreAllMocks();
  setWatchActions(null);
});

describe('checked seeds survive leaving the phone search', () => {
  it('shows the checked counts again when the screen is opened once more', async () => {
    mount();
    await search();
    expect(gate.fire).toBeTruthy();
    act(() => {
      if (gate.fire) gate.fire();
    });
    expect(el.textContent).toContain('12 сидов');
    expect(el.querySelector('.seed-live')).toBeTruthy();
    const cancelled = gate.cancelled;
    unmount();
    expect(gate.cancelled).toBe(cancelled);
    mount();
    expect(el.textContent).toContain('12 сидов');
    expect(el.querySelector('.seed-live')).toBeTruthy();
  });

  it('keeps a check that finishes while the screen is gone', async () => {
    mount();
    await search();
    const fire = gate.fire;
    expect(fire).toBeTruthy();
    unmount();
    expect(gate.cancelled).toBe(0);
    act(() => {
      if (fire) fire();
    });
    mount();
    expect(el.textContent).toContain('12 сидов');
    expect(el.querySelector('.seed-live')).toBeTruthy();
  });
});

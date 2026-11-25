import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { isDeadRelease, resetSwarmWatch, usePlaybackDead } from '../../src/lib/swarmWatch';
import type { CacheState } from '../../src/api/types';

const H = 'a'.repeat(40);

/** TorrServer /cache of a release that answers with nothing: 0 seeders, no bytes anywhere. */
const quiet = (): CacheState => ({
  Capacity: 0,
  Filled: 0,
  PiecesLength: 0,
  PiecesCount: 0,
  Torrent: { hash: H, title: 'Release', stat: 3, connected_seeders: 0, loaded_size: 0, preloaded_bytes: 0, download_speed: 0 },
});

const withFilled = (bytes: number): CacheState => {
  const c = quiet();
  c.Filled = bytes;
  return c;
};

const withSeeders = (n: number): CacheState => {
  const c = quiet();
  c.Torrent!.connected_seeders = n;
  return c;
};

function Probe(props: { cache: CacheState | null }) {
  usePlaybackDead(H, props.cache);
  return h('div', {}, isDeadRelease(H) ? 'dead' : 'alive');
}

/**
 * Seconds of the player's once-a-second /cache poll. A new object each second, like a real response:
 * `null` stands for the player having stopped asking, because frames are flowing.
 */
function poll(seconds: number, make: (() => CacheState | null) | null) {
  for (let i = 0; i < seconds; i++) {
    act(() => { render(h(Probe, { cache: make ? make() : null }), host); });
    act(() => { vi.advanceTimersByTime(1000); });
  }
}

let host: HTMLElement;

beforeEach(() => {
  resetSwarmWatch();
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => { render(h(Probe, { cache: null }), host); });
});

afterEach(() => {
  act(() => { render(null, host); });
  host.remove();
  vi.useRealTimers();
});

describe('usePlaybackDead', () => {
  it('calls a release dead after a minute of silence the player keeps seeing', () => {
    poll(30, quiet);
    expect(isDeadRelease(H)).toBe(false);
    poll(40, quiet);
    expect(isDeadRelease(H)).toBe(true);
  });

  it('drops the streak once the player plays and stops asking /cache', () => {
    poll(40, quiet);
    expect(isDeadRelease(H)).toBe(false);
    poll(90, null);
    expect(isDeadRelease(H)).toBe(false);
  });

  it('never calls a release that started playing dead, however long it then plays', () => {
    poll(90, null);
    expect(isDeadRelease(H)).toBe(false);
  });

  it('counts cache fill as an answer while the torrent counters are still zero', () => {
    poll(90, () => withFilled(5e6));
    expect(isDeadRelease(H)).toBe(false);
  });

  it('clears the streak when a seeder connects', () => {
    poll(70, quiet);
    expect(isDeadRelease(H)).toBe(true);
    poll(2, () => withSeeders(2));
    expect(isDeadRelease(H)).toBe(false);
  });
});

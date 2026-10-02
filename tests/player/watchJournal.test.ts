import { describe, it, expect, vi } from 'vitest';
import { WatchJournal, journalSource } from '../../src/player/watchJournal';
import type { PlayItem } from '../../src/player/types';

const H = 'a'.repeat(40);
const e1: PlayItem = { url: 'u1', title: 'E1', hash: H, fileIndex: 1 };
const e2: PlayItem = { url: 'u2', title: 'E2', hash: H, fileIndex: 2 };

describe('WatchJournal', () => {
  it('one entry at the start and one at the exit of an item', () => {
    const rec = vi.fn();
    const j = new WatchJournal(rec, journalSource());
    j.start(e1, 125.6, 0);
    j.start(e1, 125.6, 0); // re-render: ignored
    j.end(e1, 600.4, 2900.2);
    j.end(e1, 700, 2900); // already left
    expect(rec.mock.calls).toEqual([
      [H, { f: 1, t: 125, d: 0, src: 'tv' }],
      [H, { f: 1, t: 600, d: 2900, src: 'tv' }],
    ]);
  });

  it('next item: the previous one ends, the new one starts', () => {
    const rec = vi.fn();
    const j = new WatchJournal(rec, journalSource());
    j.start(e1, 0, 0);
    j.end(e1, 2800, 2900);
    j.start(e2, 0, 0);
    expect(rec.mock.calls.map((c) => [c[1].f, c[1].t])).toEqual([[1, 0], [1, 2800], [2, 0]]);
  });

  it('launched from a phone: written as that phone', () => {
    const rec = vi.fn();
    new WatchJournal(rec, journalSource('Pixel 7')).start(e1, 10, 0);
    expect(rec).toHaveBeenCalledWith(H, { f: 1, t: 10, d: 0, src: 'phone', name: 'Pixel 7' });
  });

  it('skips items without a torrent file, exits without a position and swallows recorder errors', () => {
    const rec = vi.fn(() => { throw new Error('boom'); });
    const j = new WatchJournal(rec, journalSource());
    j.start({ url: 'http://x', title: 'X' }, 0, 0);
    expect(rec).not.toHaveBeenCalled();
    expect(() => j.start(e1, 0, 0)).not.toThrow();
    j.end(e1, 0.5, 100); // nothing played
    expect(rec).toHaveBeenCalledTimes(1);
    j.end(e2, 100, 100); // never started
    expect(rec).toHaveBeenCalledTimes(1);
  });
});

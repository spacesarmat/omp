import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { HistoryGrid } from '../../src/screens/library/HistoryGrid';

beforeAll(() => init({ debug: false, visualDebug: false }));

const entry = (hash: string, time: number, duration: number, category?: string) => ({
  torrent: { hash, title: 'Title ' + hash, stat: 5, category },
  fileIndex: 1,
  progress: { time, duration, updated: 1 },
});

describe('HistoryGrid', () => {
  it('renders episode, position, time left and opens on click', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onOpen = vi.fn();
    const entries = [entry('a', 1394, 3651, 'tv'), entry('b', 65, 0, 'movie')];
    render(h(HistoryGrid as any, {
      entries,
      filePath: (e: any) => (e.torrent.hash === 'a' ? 'Show.S04E03.mkv' : 'Movie.mkv'),
      onOpen,
      onFocused: vi.fn(),
    }), host);
    const cards = host.querySelectorAll('.hcard');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('.hcard-ep')!.textContent).toBe('Сезон 4 · Серия 3');
    expect(cards[0].querySelector('.hcard-time')!.textContent).toContain('23:14 / 1:00:51');
    expect(cards[0].querySelector('.hcard-left')!.textContent).toBe('осталось 38 мин');
    expect(cards[0].querySelector('.progress')).not.toBeNull();
    expect(cards[1].querySelector('.hcard-ep')!.textContent).toBe('Фильм');
    expect(cards[1].querySelector('.progress')).toBeNull();
    (cards[1] as HTMLElement).click();
    expect(onOpen).toHaveBeenCalledWith(entries[1]);
  });
});

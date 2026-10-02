import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { HistoryGrid, HistoryFilterRow } from '../../src/screens/library/HistoryGrid';

beforeAll(() => init({ debug: false, visualDebug: false }));

const entry = (hash: string, time: number, duration: number, category?: string) => ({
  torrent: { hash, title: 'Title ' + hash, stat: 5, category },
  fileIndex: 1,
  progress: { time, duration, updated: 1 },
  source: { src: 'tv' as const, at: 0 },
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

describe('HistoryGrid source line', () => {
  it('shows the device with an icon and when', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const now = new Date(2026, 9, 2, 23, 0).getTime();
    const phone = { ...entry('a', 600, 2900), source: { src: 'phone' as const, name: 'Андрей', at: new Date(2026, 9, 2, 21, 40).getTime() } };
    const tv = { ...entry('b', 60, 100), source: { src: 'tv' as const, at: new Date(2026, 9, 1, 22, 15).getTime() } };
    const old = { ...entry('c', 60, 100), source: { src: 'tv' as const, at: new Date(2026, 8, 30, 12, 0).getTime() } };
    render(h(HistoryGrid as any, { entries: [phone, tv, old], now, filePath: () => 'Movie.mkv', onOpen: vi.fn(), onFocused: vi.fn() }), host);
    const lines = Array.prototype.map.call(host.querySelectorAll('.hcard-src'), (n: Element) => n.textContent);
    expect(lines).toEqual(['Телефон «Андрей» · сегодня 21:40', 'Телевизор · вчера 22:15', 'Телевизор · 30 сентября']);
    expect(host.querySelectorAll('.hcard-src svg')).toHaveLength(3);
  });
});

describe('HistoryFilterRow', () => {
  it('marks the current filter and reports a pick', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onChange = vi.fn();
    render(h(HistoryFilterRow as any, { value: 'tv', onChange }), host);
    const items = host.querySelectorAll('.hfilter');
    expect(Array.prototype.map.call(items, (n: Element) => n.textContent)).toEqual(['Все', 'С телевизора', 'С телефона']);
    expect(host.querySelector('.hfilter.active')!.textContent).toBe('С телевизора');
    (items[2] as HTMLElement).click();
    expect(onChange).toHaveBeenCalledWith('phone');
  });
});


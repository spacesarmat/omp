import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { TorrentViews } from '../../src/screens/library/TorrentViews';

beforeAll(() => init({ debug: false, visualDebug: false }));

const list = [
  { hash: 'a', title: 'Signal.One.2026.x265.WEB-DL.2160p.SDR.mkv', stat: 5, torrent_size: 9.8 * 1024 ** 3, category: 'movie' },
  { hash: 'b', title: 'Futurama.S14E09.1080p.ColdFilm.mkv', stat: 5, torrent_size: 913 * 1024 ** 2, category: 'tv' },
];

function mount(view: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onOpen = vi.fn();
  render(h(TorrentViews as any, { view, list, onOpen, onFocused: vi.fn() }), host);
  return { host, onOpen };
}

describe('TorrentViews', () => {
  it('large tiles: placeholder title, up to 3 badges with 4K, size', () => {
    const { host } = mount('large');
    const tiles = host.querySelectorAll('.tile.tile-large');
    expect(tiles).toHaveLength(2);
    expect(tiles[0].querySelector('.art-title')!.textContent).toBe('Signal One');
    const badges = Array.prototype.map.call(tiles[0].querySelectorAll('.badge'), (e: Element) => e.textContent);
    expect(badges).toEqual(['4K', 'HEVC', 'WEB-DL']);
    expect(tiles[0].querySelector('.tile-title')!.textContent).toBe('Signal One');
    expect(tiles[0].querySelector('.tile-meta')!.textContent).toBe('2026');
  });
  it('small tiles: one badge, no size line', () => {
    const { host } = mount('small');
    const tile = host.querySelector('.tile.tile-small')!;
    expect(tile.querySelectorAll('.badge')).toHaveLength(1);
    expect(tile.querySelector('.tile-meta')).toBeNull();
  });
  it('list rows show category and size', () => {
    const { host } = mount('list');
    const row = host.querySelectorAll('.lrow')[1];
    expect(row.querySelector('.lrow-cat')!.textContent).toBe('Сериалы');
    expect(row.querySelector('.lrow-size')!.textContent).toBe('913 MB');
  });
  it('compact rows open on click', () => {
    const { host, onOpen } = mount('compact');
    const rows = host.querySelectorAll('.crow');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('.badge').length).toBeLessThanOrEqual(2);
    (rows[1] as HTMLElement).click();
    expect(onOpen).toHaveBeenCalledWith(list[1]);
  });
});

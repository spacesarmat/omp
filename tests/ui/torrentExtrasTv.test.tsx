import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';
import { TorrentScreen } from '../../src/screens/Torrent';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { settings } from '../../src/store/settings';
import { routeStack } from '../../src/ui/nav';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const eps = [1, 2, 3];
const paths = eps
  .map((e) => 'Show.S01.1080p/Show.S01E0' + e + '.1080p.mkv')
  .concat(eps.map((e) => 'Show.S01.1080p/Rus Sound/LostFilm/Show.S01E0' + e + '.1080p.mka'))
  .concat(eps.map((e) => 'Show.S01.1080p/Rus Sound/Кубик в Кубе/Show.S01E0' + e + '.ac3'))
  .concat(eps.map((e) => 'Show.S01.1080p/Rus Subs/Show.S01E0' + e + '.1080p.srt'));
const dubbed: Torrent = {
  hash: 'ext1',
  title: 'Show / Сезон: 1 (2026) WEB-DL 1080p',
  category: 'tv',
  stat: 3,
  file_stats: paths.map((p, i) => ({ id: i + 1, path: p, length: p.slice(-4) === '.mkv' ? 2e9 : 2e8 })),
};
const plain: Torrent = {
  hash: 'ext2',
  title: 'Film (2026) BDRip 1080p',
  category: 'movie',
  stat: 3,
  file_stats: [{ id: 1, path: 'Film.2026.mkv', length: 1e9 }],
};

let host: HTMLElement;
const flush = async () => {
  for (let i = 0; i < 20; i++) await act(() => Promise.resolve());
};

async function mount(tor: Torrent) {
  torrents.value = [tor];
  vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(tor);
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(TorrentScreen, { hash: tor.hash }), host));
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue(null);
  routeStack.value = [{ name: 'library' }, { name: 'torrent', hash: 'x' }];
  resetSeriesMatches();
  setCatalogProvider(null);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
});

describe('TV torrent screen · external dubs and subtitles', () => {
  it('the episodes are the videos only; the header says «+2 озвучки, субтитры»', async () => {
    await mount(dubbed);
    const rows = Array.prototype.slice.call(host.querySelectorAll('.file-row')) as HTMLElement[];
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !/\.(mka|ac3|srt)/.test(r.textContent || ''))).toBe(true);
    const note = host.querySelector('[data-extras]');
    expect(note && note.textContent).toBe('+2 озвучки, субтитры');
  });

  it('webOS says honestly that the separate dubs do not play there', async () => {
    await mount(dubbed);
    const note = host.querySelector('[data-extras-note]');
    expect(note && note.textContent).toContain('webOS');
    expect(note && note.className).toContain('torrent-extras');
  });

  it('Android TV: a hint to 2160 Player with OMP own player, nothing with 2160 Player', async () => {
    (window as any).Capacitor = { getPlatform: () => 'android' };
    try {
      await mount(dubbed);
      expect((host.querySelector('[data-extras-note]') || { textContent: '' }).textContent).toContain('2160 Player');
      act(() => render(null, host));
      host.remove();
      settings.value = { ...settings.value, videoPlayer: 'p2160' };
      await mount(dubbed);
      expect(host.querySelector('[data-extras-note]')).toBeNull();
    } finally {
      delete (window as any).Capacitor;
      settings.value = { ...settings.value, videoPlayer: 'builtin' };
    }
  });

  it('no note without external files', async () => {
    await mount(plain);
    expect(host.querySelector('.torrent-extras')).toBeNull();
  });

  it('TV rules: 24px text, no gap', () => {
    const css = readFileSync('src/styles.css', 'utf8') as string;
    const rule = /\.torrent-extras \{([^}]*)\}/.exec(css);
    expect(rule && rule[1]).toContain('font-size: 24px');
    expect(rule && rule[1]).not.toMatch(/gap|aspect-ratio|inset/);
  });
});

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { TorrentScreen } from '../../src/screens/Torrent';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const H = 'a'.repeat(40);
const bare: Torrent = { hash: H, title: 'Dune 2021 1080p', stat: 1 };
const full: Torrent = { ...bare, stat: 3, file_stats: [{ id: 1, path: 'Dune.2021.1080p.mkv', length: 9e9 }] };
const flush = () =>
  act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
let host: HTMLElement;

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(TorrentScreen, { hash: H }), host));
}

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  torrents.value = [];
  vi.restoreAllMocks();
});

describe('TV torrent screen right after an add', () => {
  it('moves the cursor to «Смотреть» once the files arrive, not to «Сбросить просмотр»', async () => {
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    torrents.value = [];
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(bare);
    vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
    let info: (t: Torrent) => void = () => undefined;
    vi.spyOn(TorrServerClient.prototype, 'loadInfo').mockReturnValue(new Promise<Torrent>((r) => (info = r)));
    mount();
    await flush();
    // no files yet: the row starts with «Сбросить просмотр» and the fallback focus is there
    expect(host.querySelector('[data-fk="torrent-play"]')).toBeNull();
    expect(getCurrentFocusKey()).toBe('torrent-reset');
    info(full);
    await flush();
    expect(getCurrentFocusKey()).toBe('torrent-play');
  });
});

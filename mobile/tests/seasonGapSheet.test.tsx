import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { WatchSheet } from '../src/screens/Torrent';
import { addServer, removeServer, servers, setActiveServer } from '../../src/store/servers';
import { applyLanguageSetting } from '../../src/i18n';
import type { Torrent } from '../../src/api/types';

const files = [1, 2, 3, 4, 5, 6].map((n) => ({ id: n, path: 'Show.S06E0' + n + '.mkv', length: 1000 }));
const tor = { hash: 'abc', title: 'Star Trek', category: 'tv', stat: 3, file_stats: files } as Torrent;

let el: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  applyLanguageSetting('ru');
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
});

afterEach(() => {
  act(() => render(null, el));
});

describe('known season length on the episode sheet', () => {
  it('shows the episodes this release does not have, and Find', () => {
    act(() => render(<WatchSheet torrent={tor} file={files[0]} seasonTotal={8} onClose={() => undefined} />, el));
    expect(el.textContent).toContain('нет 7 серии 6 сезона');
    expect(el.textContent).toContain('Найти 7 серию');
  });

  it('a release that reaches the known count does not warn', () => {
    act(() => render(<WatchSheet torrent={tor} file={files[0]} seasonTotal={6} onClose={() => undefined} />, el));
    expect(el.textContent).not.toContain('Найти');
  });
});

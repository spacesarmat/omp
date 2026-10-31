// TV series screen, «Раздачи · N»: OK opens a release, the red key deletes the focused one after a confirm (what was
// watched in it moves to the one that stays); a pack holding another season is never deleted from there.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { SeriesScreen } from '../../src/screens/Series';
import { DialogHost } from '../../src/ui/dialog';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents, resetLibrary } from '../../src/store/library';
import { routeStack, currentRoute } from '../../src/ui/nav';
import { dispatchKey } from '../../src/ui/keys';
import { getLocalProgress, reloadProgress, saveProgress } from '../../src/store/progress';
import { mockFetch } from '../helpers/fetchMock';
import { setCatalogProvider } from '../../src/catalog/activeCatalog';
import { resetSeriesMatches } from '../../src/lib/seriesMatch';
import { resetEpisodeNames } from '../../src/lib/episodeNames';
import { seriesKey } from '../../src/lib/seriesGroups';

const files = (n: number, q: string) => [1, 2].map((e) => ({ id: e, path: 'Dark.Matter.S0' + n + 'E0' + e + '.' + q + '.mkv', length: 2e9 }));
const S2A = { hash: 's2a', title: 'Dark Matter S02 2160p', category: 'tv', timestamp: 4, torrent_size: 6e9, file_stats: files(2, '2160p') };
const S2B = { hash: 's2b', title: 'Dark Matter S02 1080p', category: 'tv', timestamp: 3, torrent_size: 3e9, file_stats: files(2, '1080p') };
const PACK = {
  hash: 'p12',
  title: 'Dark Matter S01-S02 720p',
  category: 'tv',
  timestamp: 2,
  torrent_size: 5e9,
  file_stats: [
    { id: 1, path: 'Dark.Matter.S01E01.mkv', length: 2e9 },
    { id: 2, path: 'Dark.Matter.S02E01.mkv', length: 2e9 },
  ],
};

let removed: string[] = [];
let list: any[] = [];

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const hosts: HTMLElement[] = [];
beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  removed = [];
  list = [S2A, S2B, PACK];
  mockFetch((url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (url.indexOf('/torrents') >= 0 && body.action === 'rem') {
      removed.push(body.hash);
      list = list.filter((x) => x.hash !== body.hash);
      return { body: '' };
    }
    return { body: url.indexOf('/torrents') >= 0 ? JSON.stringify(list) : '[]' };
  });
  setActiveServer(addServer({ url: '10.0.0.2' }).id);
  resetLibrary();
  resetSeriesMatches();
  resetEpisodeNames();
  setCatalogProvider(() => Promise.reject(new Error('offline')));
  torrents.value = list.slice() as any;
  routeStack.value = [{ name: 'library' }, { name: 'series', key: seriesKey(S2A as any) }];
});

afterEach(() => {
  while (hosts.length) {
    const host = hosts.pop()!;
    act(() => render(null, host));
  }
  setCatalogProvider(null);
});

const flush = async () => {
  for (let i = 0; i < 25; i++) await act(() => Promise.resolve());
};

async function mount() {
  const host = document.createElement('div');
  const dlg = document.createElement('div');
  hosts.push(host, dlg);
  document.body.appendChild(host);
  document.body.appendChild(dlg);
  act(() => render(h(SeriesScreen, { seriesKey: seriesKey(S2A as any), season: 2 }), host));
  act(() => render(h(DialogHost, {}), dlg));
  await flush();
  return host;
}

const title = () => (document.querySelector('.dialog-title') || { textContent: '' }).textContent || '';
const optionIndex = (label: string) =>
  Array.from(document.querySelectorAll('.dialog-option')).findIndex((o) => (o.textContent || '').indexOf(label) >= 0);

async function openList(host: HTMLElement) {
  act(() => (host.querySelector('[data-fk="series-releases"]') as HTMLElement).click());
  await flush();
}

async function redOn(label: string) {
  const i = optionIndex(label);
  expect(i).toBeGreaterThanOrEqual(0);
  act(() => setFocus('dialog-opt-' + i));
  await flush();
  act(() => { dispatchKey('red', new KeyboardEvent('keydown')); });
  await flush();
}

describe('TV «Раздачи · N»: delete with the red key', () => {
  it('shows the red key hint under the list', async () => {
    const host = await mount();
    await openList(host);
    expect(title()).toBe('Раздачи сериала');
    expect((document.querySelector('.dialog-hint') || { textContent: '' }).textContent).toContain('удалить раздачу');
    const footer = (document.querySelector('.dialog-footer') || { textContent: '' }).textContent || '';
    expect(footer).toContain('OK - открыть раздачу');
    expect(footer).toContain('удалить раздачу');
    expect(footer).toContain('Назад - закрыть');
    expect(footer).not.toContain('отметить просмотренной');
  });

  it('red on a release asks, then deletes it and moves its progress to the one that stays', async () => {
    saveProgress('s2a', 1, 600, 3000);
    saveProgress('s2b', 2, 300, 3000);
    const host = await mount();
    await openList(host);
    await redOn('1080p');
    expect(title()).toBe('Удалить раздачу «Dark Matter · 1080p · 2,8 ГБ»? Отметки просмотра перейдут в «Dark Matter · 4K · 5,6 ГБ».');
    act(() => (document.querySelector('[data-fk="dialog-opt-0"]') as HTMLElement).click());
    await flush();
    expect(removed).toEqual(['s2b']);
    expect(torrents.value.map((x) => x.hash).sort()).toEqual(['p12', 's2a']);
    expect(getLocalProgress('s2a', 2)!.time).toBe(300);
    // two releases left in the season (with the pack): the list opens again
    expect(title()).toBe('Раздачи сериала');
  });

  it('Cancel deletes nothing', async () => {
    const host = await mount();
    await openList(host);
    await redOn('1080p');
    act(() => (document.querySelector('[data-fk="dialog-opt-1"]') as HTMLElement).click());
    await flush();
    expect(removed).toEqual([]);
  });

  it('a pack holding another season is not deleted from the list', async () => {
    const host = await mount();
    await openList(host);
    await redOn('720p');
    expect(title()).toBe('Раздачи сериала');
    expect(removed).toEqual([]);
  });

  it('OK still opens the release', async () => {
    const host = await mount();
    await openList(host);
    const i = optionIndex('1080p');
    act(() => (document.querySelector('[data-fk="dialog-opt-' + i + '"]') as HTMLElement).click());
    await flush();
    expect((currentRoute.value as any).name).toBe('torrent');
    expect((currentRoute.value as any).hash).toBe('s2b');
  });
});

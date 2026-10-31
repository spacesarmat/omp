import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const cap = vi.hoisted(() => ({ url: '' }));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: () => Promise.resolve({ remove: () => {} }),
    getLaunchUrl: () => Promise.resolve(cap.url ? { url: cap.url } : null),
    minimizeApp: () => Promise.resolve(),
  },
}));

import { App } from '../src/app';
import { currentRoute, resetTo } from '../src/nav';
import { addServer, removeServer, servers, setActiveServer } from '../../src/store/servers';
import { resetTitleLink } from '../src/share/open';

let el: HTMLElement;

async function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => {
    render(<App />, el);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  cap.url = '';
  resetTitleLink();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  resetTo({ name: 'library' });
});

afterEach(() => {
  resetTitleLink();
  act(() => render(null, el));
});

describe('title link intake', () => {
  it('opens the film card from the launch url', async () => {
    cap.url = 'https://omp-player.online/t/movie/11';
    await mount();
    expect(currentRoute.value).toEqual({ name: 'title', kind: 'movie', id: 11 });
  });

  it('opens the season from the launch url', async () => {
    cap.url = 'https://www.omp-player.online/t/tv/21/s/2';
    await mount();
    expect(currentRoute.value).toEqual({ name: 'seasonCard', id: 21, season: 2 });
  });

  it('waits out the connect screen, then opens the card', async () => {
    for (const s of servers.value.slice()) removeServer(s.id);
    resetTo({ name: 'connect' });
    cap.url = 'https://omp-player.online/t/tv/9/s/2';
    await mount();
    expect(currentRoute.value.name).toBe('connect');
    act(() => {
      setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    });
    expect(currentRoute.value.name).toBe('connect');
    await act(async () => {
      resetTo({ name: 'library' });
      for (let i = 0; i < 4; i++) await Promise.resolve();
    });
    expect(currentRoute.value).toEqual({ name: 'seasonCard', id: 9, season: 2 });
  });
});

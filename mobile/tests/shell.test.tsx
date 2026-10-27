import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { App } from '../src/app';
import { currentRoute, routeStack, resetTo, navigate, goBack } from '../src/nav';
import { activeServer, setActiveServer, addServer, removeServer, servers } from '../../src/store/servers';
import { saveTv, forgetTv, tvs } from '../src/tv/tvStore';

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  render(<App />, el);
  return el;
}

// mirrors the start-route logic of mobile/src/main.tsx
function startRoute() {
  resetTo({ name: activeServer.value ? 'library' : 'connect' });
}

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  for (const tv of tvs.value.slice()) forgetTv(tv.ip);
});

describe('mobile shell', () => {
  it('starts on connect without an active server', () => {
    startRoute();
    const el = mount();
    expect(currentRoute.value.name).toBe('connect');
    expect(el.querySelector('.m-nav')).toBeNull();
  });

  it('starts on library with a server; «Пульт» is a tab only with a TV', () => {
    const s = addServer({ url: 'http://192.168.1.5:8090' });
    setActiveServer(s.id);
    startRoute();
    const el = mount();
    expect(currentRoute.value.name).toBe('library');
    const names = () => Array.from(el.querySelectorAll('.m-nav-item')).map((b) => b.textContent);
    expect(names()).toEqual(['Каталог', 'Новое', 'Поиск', 'Настройки']);
    saveTv({ ip: '192.168.1.50', name: 'LG' });
    return Promise.resolve().then(() => {
      expect(names()).toEqual(['Каталог', 'Новое', 'Поиск', 'Пульт', 'Настройки']);
    });
  });

  it('switches tab on click and keeps a single-item stack', () => {
    saveTv({ ip: '192.168.1.50', name: 'LG' });
    resetTo({ name: 'library' });
    navigate({ name: 'torrent', hash: 'x' });
    const el = mount();
    goBack();
    return Promise.resolve().then(() => {
      const items = Array.from(el.querySelectorAll<HTMLButtonElement>('.m-nav-item'));
      items.find((b) => b.textContent === 'Пульт')!.click();
      expect(currentRoute.value.name).toBe('remote');
      expect(routeStack.value).toHaveLength(1);
    });
  });

  it('navigate then goBack returns to library', () => {
    resetTo({ name: 'library' });
    navigate({ name: 'torrent', hash: 'x' });
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: 'x' });
    expect(goBack()).toBe(true);
    expect(currentRoute.value.name).toBe('library');
    expect(goBack()).toBe(false);
  });
});

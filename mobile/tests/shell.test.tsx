import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { App } from '../src/app';
import { currentRoute, routeStack, resetTo, navigate, goBack } from '../src/nav';
import { activeServer, setActiveServer, addServer, removeServer, servers } from '../../src/store/servers';

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
});

describe('mobile shell', () => {
  it('starts on connect without an active server', () => {
    startRoute();
    const el = mount();
    expect(currentRoute.value.name).toBe('connect');
    expect(el.querySelector('.m-nav')).toBeNull();
  });

  it('starts on library with a server and shows 5 tabs', () => {
    const s = addServer({ url: 'http://192.168.1.5:8090' });
    setActiveServer(s.id);
    startRoute();
    const el = mount();
    expect(currentRoute.value.name).toBe('library');
    const items = Array.from(el.querySelectorAll('.m-nav-item'));
    expect(items.map((b) => b.textContent)).toEqual(['Каталог', 'Новое', 'Добавить', 'Пульт', 'Настройки']);
  });

  it('switches tab on click and keeps a single-item stack', () => {
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Tv, setTvDiscoverer } from '../src/screens/Tv';
import { setTransport, tvState, tvError, type TvTransport } from '../src/tv/tvClient';
import { tvs, saveTv, reloadTvs, activeTvIp } from '../src/tv/tvStore';
import { currentRoute, resetTo, navigate } from '../src/nav';
import { native } from '../src/platform/native';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

class FakeTv implements TvTransport {
  connects: string[] = [];
  async tvConnect(ip: string) {
    this.connects.push(ip);
    return { port: 3000 as const };
  }
  async tvSend() {}
  onTvMessage() {
    return () => {};
  }
  onTvClosed() {
    return () => {};
  }
  async pointerConnect() {}
  async pointerSend() {}
  disconnects = 0;
  async tvDisconnect() {
    this.disconnects++;
  }
}

let fake: FakeTv;

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(<Tv />, el));
  return el;
}

function btn(el: HTMLElement, text: string): HTMLButtonElement {
  const b = Array.from(el.querySelectorAll('button')).find(
    (x) => (x.textContent || '').trim() === text || (x.getAttribute('aria-label') || '').indexOf(text + ' ') === 0,
  );
  if (!b) throw new Error('no button ' + text);
  return b as HTMLButtonElement;
}

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  fake = new FakeTv();
  setTransport(fake);
  setTvDiscoverer(async () => [
    { ip: '192.168.1.42', name: 'LG OLED в гостиной', model: 'webOS 6' },
    { ip: '192.168.1.57', name: 'LG в спальне', model: 'webOS 4' },
  ]);
  resetTo({ name: 'library' });
  navigate({ name: 'tv' });
});

afterEach(() => {
  setTvDiscoverer(null);
  setTransport(native);
});

describe('Tv screen', () => {
  it('renders a card per discovered TV', async () => {
    const el = mount();
    expect(el.textContent).toContain('Ищу телевизоры');
    await flush();
    expect(el.querySelectorAll('.m-tv')).toHaveLength(2);
    expect(el.textContent).not.toContain('Ищу телевизоры');
  });

  it('puts saved TVs first with a mark and lets forget them', async () => {
    saveTv({ ip: '192.168.1.57', name: 'LG в спальне', clientKey: 'k' });
    const el = mount();
    await flush();
    const cards = el.querySelectorAll<HTMLElement>('.m-tv');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('LG в спальне');
    expect(cards[0].textContent).toContain('сохранён');
    await act(async () => btn(cards[0], 'Забыть').click());
    expect(tvs.value).toHaveLength(0);
  });

  it('renames a saved TV through the sheet and restores the default on empty', async () => {
    saveTv({ ip: '192.168.1.57', name: 'LG в спальне', clientKey: 'k' });
    const el = mount();
    await flush();
    await act(async () => (el.querySelector('[aria-label="Переименовать LG в спальне"]') as HTMLButtonElement).click());
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dlg.textContent).toContain('Название телевизора');
    const input = dlg.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('LG в спальне');
    input.value = 'Спальня';
    await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { btn(dlg, 'Сохранить').click(); });
    expect(tvs.value[0].name).toBe('Спальня');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(el.textContent).toContain('Спальня');
    await act(async () => (el.querySelector('[aria-label="Переименовать Спальня"]') as HTMLButtonElement).click());
    const d2 = document.querySelector('[role="dialog"]') as HTMLElement;
    const i2 = d2.querySelector('input') as HTMLInputElement;
    i2.value = '';
    await act(async () => { i2.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { btn(d2, 'Сохранить').click(); });
    expect(tvs.value[0].name).toBe('LG в спальне');
  });

  it('cancel leaves the name alone and discovered TVs have no rename button', async () => {
    saveTv({ ip: '192.168.1.57', name: 'LG в спальне', clientKey: 'k' });
    const el = mount();
    await flush();
    expect(el.querySelectorAll('[aria-label^="Переименовать"]')).toHaveLength(1);
    await act(async () => (el.querySelector('[aria-label^="Переименовать"]') as HTMLButtonElement).click());
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () => { btn(dlg, 'Отмена').click(); });
    expect(tvs.value[0].name).toBe('LG в спальне');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the confirmation hint while pairing', async () => {
    const el = mount();
    await flush();
    await act(async () => (el.querySelector('.m-tv-main') as HTMLButtonElement).click());
    expect(fake.connects).toEqual(['192.168.1.42']);
    expect(el.querySelector('.m-hint-warn')).toBeNull();
    await act(async () => {
      tvState.value = 'pairing';
    });
    expect(el.querySelectorAll('.m-hint-warn')).toHaveLength(1);
    expect(el.querySelector('.m-hint-warn')?.textContent).toContain('«Разрешить»');
  });

  it('shows Подключён for the connected active TV', async () => {
    saveTv({ ip: '192.168.1.42', name: 'LG OLED в гостиной', clientKey: 'k' });
    const el = mount();
    await flush();
    await act(async () => (el.querySelector('.m-tv-main') as HTMLButtonElement).click());
    await act(async () => {
      tvState.value = 'connected';
    });
    expect(activeTvIp.value).toBe('192.168.1.42');
    expect(el.querySelector('.m-tv.connected')?.textContent).toContain('Подключён');
  });

  it('connects by manually entered IP and rejects an invalid one', async () => {
    const el = mount();
    await flush();
    await act(async () => btn(el, 'Ввести IP-адрес телевизора').click());
    const input = el.querySelector<HTMLInputElement>('#tv-ip')!;
    input.value = '300.1.1.1';
    act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => btn(el, 'Подключить').click());
    expect(el.querySelector('.m-error')).not.toBeNull();
    expect(fake.connects).toHaveLength(0);
    input.value = '192.168.1.99';
    act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => btn(el, 'Подключить').click());
    expect(fake.connects).toEqual(['192.168.1.99']);
  });

  async function manualConnect(el: HTMLElement) {
    await act(async () => btn(el, 'Ввести IP-адрес телевизора').click());
    const input = el.querySelector<HTMLInputElement>('#tv-ip')!;
    input.value = '192.168.1.99';
    act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => btn(el, 'Подключить').click());
  }

  it('shows a transient card with pairing hint and error for a manual IP', async () => {
    const el = mount();
    await flush();
    await manualConnect(el);
    const card = () => Array.from(el.querySelectorAll<HTMLElement>('.m-tv')).find((c) => c.textContent!.includes('Телевизор 192.168.1.99'));
    expect(card()?.textContent).toContain('подключение…');
    await act(async () => {
      tvState.value = 'pairing';
    });
    expect(card()?.querySelector('.m-hint-warn')).not.toBeNull();
    await act(async () => {
      tvError.value = 'Телевизор не отвечает';
      tvState.value = 'error';
    });
    expect(card()?.querySelector('.m-error')?.textContent).toBe('Телевизор не отвечает');
  });

  it('forgetting the live TV disconnects it and clears Подключён', async () => {
    saveTv({ ip: '192.168.1.42', name: 'LG OLED в гостиной', clientKey: 'k' });
    const el = mount();
    await flush();
    await act(async () => (el.querySelector('.m-tv-main') as HTMLButtonElement).click());
    await act(async () => {
      tvState.value = 'connected';
    });
    expect(el.textContent).toContain('Подключён');
    await act(async () => (el.querySelector('[aria-label="Забыть LG OLED в гостиной"]') as HTMLButtonElement).click());
    await flush();
    expect(fake.disconnects).toBeGreaterThan(0);
    expect(el.textContent).not.toContain('Подключён');
    expect(tvs.value).toHaveLength(0);
  });

  it('goes back', async () => {
    const el = mount();
    await flush();
    await act(async () => (el.querySelector('[aria-label="Назад"]') as HTMLButtonElement).click());
    expect(currentRoute.value.name).toBe('library');
  });
});

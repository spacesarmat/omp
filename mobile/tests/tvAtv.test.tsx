import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { mockFetch } from '../../tests/helpers/fetchMock';
import { Tv, setTvDiscoverer, setAtvDiscoverer } from '../src/screens/Tv';
import { setTransport, disconnectTv, connectTv, tvState, type TvTransport } from '../src/tv/tvClient';
import { tvs, saveTv, reloadTvs, activeTv } from '../src/tv/tvStore';
import { resetTo, navigate } from '../src/nav';
import { native } from '../src/platform/native';

const TOKEN = '0123456789abcdef0123456789abcdef';
const BASE = 'http://192.168.1.40:8095';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

const lgConnects: string[] = [];
const ssap: TvTransport = {
  tvConnect: async (ip) => (lgConnects.push(ip), { port: 3000 }),
  tvSend: async () => {},
  onTvMessage: () => () => {},
  onTvClosed: () => () => {},
  pointerConnect: async () => {},
  pointerSend: async () => {},
  tvDisconnect: async () => {},
};

let pairAnswer: { status?: number; body: string };
let paired: boolean;
let calls: { url: string; method: string; body: any }[];

function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(<Tv />, el));
  return el;
}

const card = (el: HTMLElement, name: string) =>
  Array.from(el.querySelectorAll<HTMLElement>('.m-tv')).find((c) => c.querySelector('.m-server-name')?.textContent === name)!;
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const cells = () => Array.from(dialog()!.querySelectorAll<HTMLInputElement>('input'));
const button = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text) as HTMLButtonElement;

function type(input: HTMLInputElement, value: string) {
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  lgConnects.length = 0;
  calls = [];
  paired = true;
  pairAnswer = { body: JSON.stringify({ token: TOKEN }) };
  setTransport(ssap);
  setTvDiscoverer(async () => [{ ip: '192.168.1.57', name: 'Спальня', model: 'webOS 6' }]);
  setAtvDiscoverer(async () => [{ ip: '192.168.1.40', port: 8095, name: 'Гостиная', version: '0.10.0' }]);
  mockFetch((url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method || 'GET', body });
    if (url === BASE + '/omp/pair') return pairAnswer;
    if (url === BASE + '/omp/info') {
      const ok = paired && init.headers?.Authorization === 'Bearer ' + TOKEN;
      return { body: JSON.stringify({ name: 'Гостиная', version: '0.10.0', paired: ok, foreground: true }) };
    }
    return { body: '{"ok":true}' };
  });
  resetTo({ name: 'library' });
  navigate({ name: 'tv' });
});

afterEach(async () => {
  act(() => render(null, document.getElementById('app')!));
  setTvDiscoverer(null);
  setAtvDiscoverer(null);
  await disconnectTv();
  setTransport(native);
  vi.unstubAllGlobals();
});

describe('Tv screen with Android TV', () => {
  it('lists LG and Android TV together with kind badges', async () => {
    const el = mount();
    expect(el.textContent).toContain('Ищу телевизоры…');
    await flush();
    expect(el.querySelectorAll('.m-tv')).toHaveLength(2);
    const atv = card(el, 'Гостиная');
    expect(atv.textContent).toContain('192.168.1.40 · OMP 0.10.0');
    expect(atv.querySelector('.m-tv-kind')?.textContent).toBe('Android TV');
    expect(card(el, 'Спальня').querySelector('.m-tv-kind')?.textContent).toBe('LG webOS');
  });

  it('a saved Android TV found again is one row with its OMP version', async () => {
    saveTv({ ip: '192.168.1.40', name: 'Зал', kind: 'atv', token: TOKEN, ctlPort: 8095 });
    saveTv({ ip: '192.168.1.57', name: 'Спальня', clientKey: 'k' });
    const el = mount();
    await flush();
    expect(el.querySelectorAll('.m-tv')).toHaveLength(2);
    expect(card(el, 'Зал').textContent).toContain('192.168.1.40 · OMP 0.10.0');
    expect(card(el, 'Спальня').textContent).toContain('сохранён');
  });

  it('a new Android TV opens the code sheet and pairs by the code', async () => {
    const el = mount();
    await flush();
    await act(async () => (card(el, 'Гостиная').querySelector('.m-tv-main') as HTMLButtonElement).click());
    const d = dialog()!;
    expect(d.textContent).toContain('Гостиная · Android TV');
    expect(d.textContent).toContain('На телевизоре откройте OMP → Настройки → «Подключить телефон» и введите код с экрана.');
    expect(cells()).toHaveLength(4);
    expect(cells()[0].getAttribute('inputmode')).toBe('numeric');
    expect(button(d, 'Подключить').disabled).toBe(true);
    type(cells()[0], '0');
    expect(document.activeElement).toBe(cells()[1]);
    type(cells()[1], '4');
    type(cells()[2], 'x');
    expect(cells()[2].value).toBe('');
    type(cells()[2], '8');
    type(cells()[3], '2');
    await act(async () => button(dialog()!, 'Подключить').click());
    await flush();
    expect(calls.find((c) => c.url === BASE + '/omp/pair')!.body).toEqual({ code: '0482', phone: 'Телефон' });
    expect(dialog()).toBeNull();
    expect(tvs.value.find((t) => t.ip === '192.168.1.40')).toMatchObject({ kind: 'atv', token: TOKEN });
    expect(activeTv.value?.ip).toBe('192.168.1.40');
    expect(tvState.value).toBe('connected');
    expect(card(el, 'Гостиная').textContent).toContain('Подключён');
    expect(lgConnects).toEqual([]);
  });

  it('pasting four digits fills every cell', async () => {
    const el = mount();
    await flush();
    await act(async () => (card(el, 'Гостиная').querySelector('.m-tv-main') as HTMLButtonElement).click());
    type(cells()[0], '1234');
    expect(cells().map((c) => c.value)).toEqual(['1', '2', '3', '4']);
    expect(button(dialog()!, 'Подключить').disabled).toBe(false);
  });

  it('backspace in an empty cell goes back', async () => {
    const el = mount();
    await flush();
    await act(async () => (card(el, 'Гостиная').querySelector('.m-tv-main') as HTMLButtonElement).click());
    type(cells()[0], '1');
    act(() => {
      cells()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });
    expect(document.activeElement).toBe(cells()[0]);
    expect(cells()[0].value).toBe('');
  });

  it('shows «Неверный код» and «Код устарел…» in the sheet', async () => {
    const el = mount();
    await flush();
    await act(async () => (card(el, 'Гостиная').querySelector('.m-tv-main') as HTMLButtonElement).click());
    pairAnswer = { status: 403, body: '{"error":"bad_code"}' };
    type(cells()[0], '1111');
    await act(async () => button(dialog()!, 'Подключить').click());
    await flush();
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Неверный код');
    pairAnswer = { status: 403, body: '{"error":"expired"}' };
    await act(async () => button(dialog()!, 'Подключить').click());
    await flush();
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Код устарел — нажмите «Новый код» на телевизоре');
    expect(tvs.value).toEqual([]);
  });

  it('Отмена closes the sheet', async () => {
    const el = mount();
    await flush();
    await act(async () => (card(el, 'Гостиная').querySelector('.m-tv-main') as HTMLButtonElement).click());
    await act(async () => button(dialog()!, 'Отмена').click());
    expect(dialog()).toBeNull();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('a paired Android TV just connects', async () => {
    saveTv({ ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: TOKEN, ctlPort: 8095 });
    const el = mount();
    await flush();
    await act(async () => (card(el, 'Гостиная').querySelector('.m-tv-main') as HTMLButtonElement).click());
    await flush();
    expect(dialog()).toBeNull();
    expect(calls.filter((c) => c.url === BASE + '/omp/info')).toHaveLength(1);
    expect(card(el, 'Гостиная').textContent).toContain('Подключён');
  });

  it('a TV found forgetful elsewhere (remote, warm-up) asks for a code on the first tap', async () => {
    saveTv({ ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: TOKEN, ctlPort: 8095 });
    paired = false;
    await connectTv(activeTv.value!).catch(() => {});
    const el = mount();
    await flush();
    const before = calls.length;
    await act(async () => (card(el, 'Гостиная').querySelector('.m-tv-main') as HTMLButtonElement).click());
    expect(dialog()?.textContent).toContain('Гостиная · Android TV');
    expect(calls.length).toBe(before);
  });

  it('a paired TV that then fails to connect closes the sheet and shows the error in its row', async () => {
    const el = mount();
    await flush();
    await act(async () => (card(el, 'Гостиная').querySelector('.m-tv-main') as HTMLButtonElement).click());
    paired = false;
    type(cells()[0], '0482');
    await act(async () => button(dialog()!, 'Подключить').click());
    await flush();
    expect(dialog()).toBeNull();
    expect(tvs.value.find((t) => t.ip === '192.168.1.40')).toMatchObject({ kind: 'atv' });
    expect(card(el, 'Гостиная').querySelector('.m-error')?.textContent).toBe('Телевизор забыл этот телефон — подключитесь заново кодом');
  });

  it('a TV that forgot the phone shows the error, the next tap asks for a code', async () => {
    saveTv({ ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: TOKEN, ctlPort: 8095 });
    paired = false;
    const el = mount();
    await flush();
    await act(async () => (card(el, 'Гостиная').querySelector('.m-tv-main') as HTMLButtonElement).click());
    await flush();
    expect(card(el, 'Гостиная').querySelector('.m-error')?.textContent).toBe('Телевизор забыл этот телефон — подключитесь заново кодом');
    await act(async () => (card(el, 'Гостиная').querySelector('.m-tv-main') as HTMLButtonElement).click());
    expect(dialog()?.textContent).toContain('Гостиная · Android TV');
  });
});

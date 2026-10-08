import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Connect } from '../src/screens/Connect';
import { resetTo, currentRoute } from '../src/nav';
import { removeServer, servers, setActiveServer, activeServer } from '../../src/store/servers';
import { addressInputMode, setAddressInputMode } from '../../src/lib/addressKeypad';
import { mockFetch } from '../../tests/helpers/fetchMock';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

let el: HTMLElement;
function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Connect />, el));
  return el;
}

const input = () => el.querySelector<HTMLInputElement>('#addr')!;
const pad = () => el.querySelector('.m-keypad');
const key = (k: string) => el.querySelector<HTMLButtonElement>('.m-kp-key--' + k)!;
const digit = (d: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('.m-kp-key')).find((b) => b.textContent === d)!;
const tap = (b: HTMLElement) => act(() => b.click());
const typeKeys = (s: string) => {
  for (const c of s) tap(c === '.' || c === ':' || /\d/.test(c) ? digit(c) : key(c));
};

function openPad() {
  act(() => input().focus());
}

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(null);
  resetTo({ name: 'connect' });
  setAddressInputMode('keypad');
});
afterEach(() => {
  act(() => render(null, el));
  vi.useRealTimers();
});

describe('phone address keypad', () => {
  it('the field opens the keypad, not the system keyboard; it is docked with large keys', () => {
    mount();
    expect(input().getAttribute('inputmode')).toBe('none');
    expect(pad()).toBeNull();
    openPad();
    expect(pad()).not.toBeNull();
    expect(pad()!.querySelectorAll('button')).toHaveLength(17);
    expect(document.documentElement.classList.contains('m-keypad-open')).toBe(true);
  });

  it('types, erases and sets the scheme; «Подключиться» on the keypad connects', async () => {
    const f = mockFetch(() => ({ body: 'MatriX.145.1' }));
    mount();
    openPad();
    typeKeys('192.168.1.10:80900');
    expect(input().value).toBe('192.168.1.10:80900');
    tap(key('back'));
    expect(input().value).toBe('192.168.1.10:8090');
    tap(key('https'));
    expect(input().value).toBe('https://192.168.1.10:8090');
    tap(key('http'));
    expect(input().value).toBe('http://192.168.1.10:8090');
    await act(async () => key('submit').click());
    await flush();
    expect(pad()).toBeNull();
    expect(f.mock.calls.some((c) => String(c[0]).startsWith('http://192.168.1.10:8090/echo'))).toBe(true);
    expect(activeServer.value?.url).toBe('http://192.168.1.10:8090');
    expect(currentRoute.value.name).toBe('library');
  });

  it('edits at the caret the user tapped', () => {
    mount();
    openPad();
    typeKeys('19268');
    act(() => input().setSelectionRange(2, 2));
    tap(digit('2'));
    expect(input().value).toBe('192268');
    expect(input().selectionStart).toBe(3);
    tap(key('back'));
    expect(input().value).toBe('19268');
    act(() => input().setSelectionRange(3, 5));
    tap(digit('.'));
    expect(input().value).toBe('192.');
  });

  it('a long press on ⌫ clears the field; the tap after it is not a second erase', () => {
    vi.useFakeTimers();
    mount();
    openPad();
    typeKeys('10.0.0.1');
    const b = key('back');
    act(() => { b.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 })); });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { b.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); });
    tap(b);
    expect(input().value).toBe('');
  });

  it('«Клавиатура» switches to the system keyboard (remembered), «123» back to the keypad', () => {
    mount();
    openPad();
    typeKeys('10');
    tap(key('system'));
    expect(pad()).toBeNull();
    expect(addressInputMode.value).toBe('system');
    expect(localStorage.getItem('tsp.addressInput')).toBe('"system"');
    expect(input().getAttribute('inputmode')).toBe('url');
    expect(document.activeElement).toBe(input());
    expect(input().value).toBe('10');
    // a host name from the system keyboard
    input().value = 'nas.local:8090';
    act(() => { input().dispatchEvent(new Event('input', { bubbles: true })); });
    const back = el.querySelector<HTMLButtonElement>('.m-addr-switch')!;
    expect(back.getAttribute('aria-label')).toBe('Цифровая клавиатура OMP');
    tap(back);
    expect(addressInputMode.value).toBe('keypad');
    expect(input().getAttribute('inputmode')).toBe('none');
    expect(pad()).not.toBeNull();
    expect(input().value).toBe('nas.local:8090');
  });

  it('the remembered system keyboard: a plain URL field, no keypad', () => {
    setAddressInputMode('system');
    mount();
    act(() => input().focus());
    expect(input().getAttribute('inputmode')).toBe('url');
    expect(pad()).toBeNull();
  });

  it('a tap outside the field and the keypad hides it', () => {
    mount();
    openPad();
    act(() => { el.querySelector('.m-title')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(pad()).toBeNull();
    expect(document.documentElement.classList.contains('m-keypad-open')).toBe(false);
  });
});

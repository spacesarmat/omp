import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { ConnectScreen } from '../../src/screens/Connect';
import { EditServerDialog } from '../../src/screens/connect/EditServerDialog';
import { installKeyListener } from '../../src/ui/keys';
import { servers, activeServerId, addServer } from '../../src/store/servers';
import { addressInputMode, setAddressInputMode } from '../../src/lib/addressKeypad';
import { keypadKeyFk } from '../../src/ui/AddressField';
import { mockFetch } from '../helpers/fetchMock';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let host: HTMLElement;
let uninstall: () => void;
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  setAddressInputMode('keypad');
  mockFetch(() => ({ body: 'MatriX.145.1' }));
  uninstall = installKeyListener(() => true);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  uninstall();
});

const flush = async () => {
  for (let r = 0; r < 4; r++) {
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise((res) => setTimeout(res, 0));
    });
  }
};

function mount(node: VNode<any> = h(ConnectScreen, {})) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(node, host));
  return host;
}

/** A key press; spatial navigation runs it (and setFocus) through its own queue. */
async function press(keyCode: number) {
  act(() => {
    const e = new Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { value: keyCode });
    Object.defineProperty(e, 'which', { value: keyCode });
    (document.activeElement || document.body).dispatchEvent(e);
  });
  await flush();
}

const field = () => host.querySelector('.connect-card input') as HTMLInputElement;
const key = (k: string) => host.querySelector('.kp-key--' + (k === '.' || k === ':' ? (k === '.' ? '\\.' : '\\:') : k)) as HTMLElement;
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });

describe('TV address keypad', () => {
  it('the field is read-only for the system keyboard; OK (or a click) opens the keypad', async () => {
    mount();
    expect(field().readOnly).toBe(true);
    expect(host.querySelector('.keypad')).toBeNull();
    click(host.querySelector('.address-input')!);
    await flush();
    expect(host.querySelectorAll('.kp-key')).toHaveLength(17);
    expect(getCurrentFocusKey()).toBe(keypadKeyFk('connect-url', '1'));
    expect(key('submit').textContent).toBe('Подключиться');
  });

  it('keys type, erase and set the scheme; «Подключиться» connects to the typed address', async () => {
    const seen: string[] = [];
    mockFetch((u: string) => { seen.push(u); return { body: 'MatriX.145.1' }; });
    mount();
    click(host.querySelector('.address-input')!);
    await flush();
    for (const k of ['1', '0', '.', '0', '.', '0', '.', '7', '7', ':', '8', '0', '9', '0']) click(host.querySelector('[data-fk="' + keypadKeyFk('connect-url', k as never) + '"]')!);
    expect(field().value).toBe('10.0.0.77:8090');
    click(key('back'));
    click(key('back'));
    expect(field().value).toBe('10.0.0.77:80');
    click(host.querySelector('[data-fk="' + keypadKeyFk('connect-url', '9') + '"]')!);
    click(host.querySelector('[data-fk="' + keypadKeyFk('connect-url', '1') + '"]')!);
    click(key('https'));
    expect(field().value).toBe('https://10.0.0.77:8091');
    click(key('http'));
    expect(field().value).toBe('http://10.0.0.77:8091');
    click(key('submit'));
    await flush();
    expect(host.querySelector('.keypad')).toBeNull();
    expect(seen[0]).toBe('http://10.0.0.77:8091/echo');
    expect(servers.value.map((s) => s.url)).toEqual(['http://10.0.0.77:8091']);
  });

  it('the remote number keys type digits on the focused field and in the keypad', async () => {
    mount();
    act(() => setFocus('connect-url'));
    await flush();
    await press(49); // 1
    await press(57); // 9
    await press(50); // 2
    expect(field().value).toBe('192');
    click(host.querySelector('.address-input')!);
    await flush();
    await press(48);
    await press(101); // numpad 5
    expect(field().value).toBe('19205');
  });

  it('number keys do nothing when the field is not focused', async () => {
    mount();
    act(() => setFocus('connect-advanced'));
    await flush();
    await press(49);
    expect(field().value).toBe('');
  });

  it('arrows move within the keypad (into «Подключиться» and back up to the same column)', async () => {
    mount();
    click(host.querySelector('.address-input')!);
    await flush();
    const at = () => getCurrentFocusKey();
    await press(39);
    expect(at()).toBe(keypadKeyFk('connect-url', '2'));
    await press(40);
    await press(40);
    expect(at()).toBe(keypadKeyFk('connect-url', '8'));
    await press(40);
    expect(at()).toBe(keypadKeyFk('connect-url', '0'));
    await press(40);
    expect(at()).toBe(keypadKeyFk('connect-url', 'submit'));
    await press(38);
    expect(at()).toBe(keypadKeyFk('connect-url', '0'));
    await press(39);
    await press(39);
    expect(at()).toBe(keypadKeyFk('connect-url', 'system'));
    await press(39); // the edge: stays
    expect(at()).toBe(keypadKeyFk('connect-url', 'system'));
    await press(38);
    await press(38);
    await press(38);
    await press(38);
    expect(at()).toBe(keypadKeyFk('connect-url', 'back'));
  });

  it('Back hides the keypad and returns to the field; the screen does not go back', async () => {
    mount();
    click(host.querySelector('.address-input')!);
    await flush();
    await press(461);
    await flush();
    expect(host.querySelector('.keypad')).toBeNull();
    expect(getCurrentFocusKey()).toBe('connect-url');
  });

  it('«Клавиатура» switches to the system keyboard (remembered); «123» brings the keypad back', async () => {
    mount();
    act(() => setFocus('connect-url'));
    await flush();
    await press(49);
    click(host.querySelector('.address-input')!);
    await flush();
    click(key('system'));
    await flush();
    expect(addressInputMode.value).toBe('system');
    expect(localStorage.getItem('tsp.addressInput')).toBe('"system"');
    expect(host.querySelector('.keypad')).toBeNull();
    expect(field().readOnly).toBe(false);
    expect(field().value).toBe('1');
    expect(document.activeElement).toBe(field());
    // the system keyboard types anything (host names)
    field().value = 'nas.local:8090';
    act(() => { field().dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => field().blur());
    click(host.querySelector('.kp-switch')!);
    await flush();
    expect(addressInputMode.value).toBe('keypad');
    expect(host.querySelector('.keypad')).not.toBeNull();
    expect(field().readOnly).toBe(true);
    expect(field().value).toBe('nas.local:8090');
  });

  it('the server editor uses the keypad too: «Готово» closes it without saving', async () => {
    const s = addServer({ url: '192.168.1.191:5665', name: 'Дом' });
    mount(h(EditServerDialog, { server: s, onClose: () => {} }));
    const url = () => host.querySelector('[data-fk="edit-url"] input') as HTMLInputElement;
    expect(url().value).toBe('192.168.1.191:5665');
    click(host.querySelector('[data-fk="edit-url"]')!);
    await flush();
    click(host.querySelector('.kp-key--back')!);
    click(host.querySelector('[data-fk="' + keypadKeyFk('edit-url', '7') + '"]')!);
    expect(url().value).toBe('192.168.1.191:5667');
    expect(host.querySelector('.kp-key--submit')!.textContent).toBe('Готово');
    click(host.querySelector('.kp-key--submit')!);
    await flush();
    expect(host.querySelector('.keypad')).toBeNull();
    expect(servers.value[0].url).toBe('http://192.168.1.191:5665');
  });
});

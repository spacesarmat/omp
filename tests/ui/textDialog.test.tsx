import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { TextDialogHost, askText } from '../../src/ui/TextDialog';
import { dispatchKey } from '../../src/ui/keys';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let host: HTMLElement;
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});
function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(TextDialogHost, {}), host));
}
const type = (v: string) => act(() => {
  const i = host.querySelector('input') as HTMLInputElement;
  i.value = v;
  i.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('askText', () => {
  it('resolves the typed text on Enter', async () => {
    mount();
    let r: unknown = 'pending';
    await act(async () => { askText('Имя', 'Старое').then((v) => { r = v; }); });
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Старое');
    type('Новое имя');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true, cancelable: true } as any)); });
    expect(r).toBe('Новое имя');
    expect(host.querySelector('.dialog-backdrop')).toBeNull();
  });

  it('resolves null on Back', async () => {
    mount();
    let r: unknown = 'pending';
    await act(async () => { askText('Имя', 'Старое').then((v) => { r = v; }); });
    await act(async () => { dispatchKey('back', new KeyboardEvent('keydown')); });
    expect(r).toBeNull();
    expect(host.querySelector('.dialog-backdrop')).toBeNull();
  });
});

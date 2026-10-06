// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { TextDialogHost, askText, textDialogOpen } from '../../src/ui/TextDialog';
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

describe('textDialogOpen', () => {
  it('is true while the text dialog is on screen, so app dialogs wait', async () => {
    mount();
    expect(textDialogOpen.value).toBe(false);
    await act(async () => { askText('Имя', 'x'); });
    expect(textDialogOpen.value).toBe(true);
    await act(async () => { dispatchKey('back', new KeyboardEvent('keydown')); });
    expect(textDialogOpen.value).toBe(false);
  });
  it('the app gates the update and what-is-new dialogs on it', () => {
    const src = readFileSync('src/app.tsx', 'utf8');
    expect(src).toContain('textDialogOpen.value');
    expect(src.split('!anyDialog').length - 1).toBe(2);
  });
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

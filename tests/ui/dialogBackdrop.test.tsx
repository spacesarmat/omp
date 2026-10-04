import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { DialogHost, choose, confirmDialog } from '../../src/ui/dialog';
import { MarksDialog } from '../../src/ui/MarksDialog';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let host: HTMLElement;
const tap = vi.fn();
function mount(node: preact.VNode<any>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  // the parent stands for the player's tap-zone handler
  act(() => render(h('div', { class: 'player', onClick: tap }, node), host));
}
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  tap.mockClear();
});
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });

describe('dialog backdrop click', () => {
  it('choose() resolves null and the tap handler is not called', async () => {
    mount(h(DialogHost, {}));
    let r: unknown = 'pending';
    await act(async () => { choose('T', [{ label: 'A', value: 1 }]).then((v) => { r = v; }); });
    click(host.querySelector('.dialog-backdrop')!);
    await act(async () => { await Promise.resolve(); });
    expect(r).toBeNull();
    expect(host.querySelector('.dialog-backdrop')).toBeNull();
    expect(tap).not.toHaveBeenCalled();
  });

  it('confirmDialog resolves false', async () => {
    mount(h(DialogHost, {}));
    let r: unknown = 'pending';
    await act(async () => { confirmDialog('Точно?').then((v) => { r = v; }); });
    click(host.querySelector('.dialog-backdrop')!);
    await act(async () => { await Promise.resolve(); });
    expect(r).toBe(false);
  });

  it('a click inside the box does not close it', async () => {
    mount(h(DialogHost, {}));
    let r: unknown = 'pending';
    await act(async () => { choose('T', [{ label: 'A', value: 1 }]).then((v) => { r = v; }); });
    click(host.querySelector('.dialog-title')!);
    await act(async () => { await Promise.resolve(); });
    expect(r).toBe('pending');
    expect(host.querySelector('.dialog-backdrop')).not.toBeNull();
    click(host.querySelector('.dialog-option')!); // the option itself still chooses
    await act(async () => { await Promise.resolve(); });
    expect(r).toBe(1);
  });
});

describe('marks dialog backdrop click', () => {
  const m = (onSave: () => Promise<unknown>, onClose: () => void) =>
    mount(h(MarksDialog, { subtitle: 's', prefs: { mi: [45, 135], mc: 90 }, onSave, onClose }));

  it('closes without saving; tap handler not called', () => {
    const onSave = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    m(onSave, onClose);
    click(host.querySelector('.dialog-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(tap).not.toHaveBeenCalled();
  });

  it('a click inside the box does not close it', () => {
    const onClose = vi.fn();
    m(() => Promise.resolve(), onClose);
    click(host.querySelector('.marks-sub')!);
    expect(onClose).not.toHaveBeenCalled();
  });
});

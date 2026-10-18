import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Focusable } from '../../src/ui/components';
import { WhatsNewDialog, shouldShowWhatsNew, focusWhatsNew } from '../../src/ui/WhatsNewDialog';
import { whatsNew, closeWhatsNew } from '../../src/store/whatsNew';
import { dialogRestoreKey, restoreFocus } from '../../src/ui/focus';
import { TopBar } from '../../src/ui/TopBar';
import { dispatchKey } from '../../src/ui/keys';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => {
  document.body.innerHTML = '';
  closeWhatsNew();
});

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(h(WhatsNewDialog, {}), host);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return host;
}

describe('WhatsNewDialog', () => {
  it('renders nothing when closed', async () => {
    const host = await mount();
    expect(host.querySelector('.dialog')).toBeNull();
  });

  it('lists versions with bullets and OK closes it', async () => {
    whatsNew.value = {
      title: 'Что нового в 0.2.0', auto: true,
      entries: [{ version: '0.2.0', items: ['А', 'Б'] }, { version: '0.1.0', items: ['В'] }],
    };
    const host = await mount();
    expect(host.textContent).toContain('Что нового в 0.2.0');
    expect(host.querySelectorAll('.whatsnew-ver')).toHaveLength(2);
    expect(host.querySelectorAll('li')).toHaveLength(3);
    const ok = Array.from(host.querySelectorAll('.button')).find((b) => b.textContent === 'OK') as HTMLElement;
    await act(async () => { ok.click(); });
    expect(whatsNew.value).toBeNull();
    expect(host.querySelector('.dialog')).toBeNull();
  });

  it('Back closes it', async () => {
    whatsNew.value = { title: 'Что нового', auto: false, entries: [{ version: '0.2.0', items: ['А'] }] };
    await mount();
    await act(async () => { dispatchKey('back', new KeyboardEvent('keydown')); });
    expect(whatsNew.value).toBeNull();
  });

  it('takes focus onto OK and keeps a late screen restore from stealing it', async () => {
    let opened = false;
    whatsNew.value = { title: 'Что нового в 0.2.0', auto: true, entries: [{ version: '0.2.0', items: ['А'] }] };
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      render(h('div', {},
        h('div', { class: 'screen-host' },
          h(Focusable, { focusKey: 'tile-1', onPress: () => { opened = true; } }, 'tile'),
        ),
        h(WhatsNewDialog, {}),
      ), host);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(getCurrentFocusKey()).toBe('whatsnew-ok');
    await act(async () => { await setFocus('tile-1'); });
    expect(getCurrentFocusKey()).toBe('tile-1');
    expect(dispatchKey('enter', new KeyboardEvent('keydown'))).toBe(true);
    expect(opened).toBe(false);
    focusWhatsNew();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(getCurrentFocusKey()).toBe('whatsnew-ok');
    restoreFocus('tile-1');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(getCurrentFocusKey()).toBe('whatsnew-ok');
    render(null, host);
  });

  it('closing restores the tile behind it and does not open История', async () => {
    const onTab = vi.fn();
    whatsNew.value = { title: 'Что нового в 0.2.0', auto: true, entries: [{ version: '0.2.0', items: ['А'] }] };
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      render(h('div', {},
        h('div', { class: 'screen-host' },
          h(TopBar, { tab: 'all', onTab, view: 'large', sort: 'new', searchOpen: false, onSearch: () => undefined, onView: () => undefined, onSort: () => undefined, onFocused: () => undefined }),
          h(Focusable, { focusKey: 'tile-1' }, 'tile'),
        ),
        h(WhatsNewDialog, {}),
      ), host);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(getCurrentFocusKey()).toBe('whatsnew-ok');
    const ok = host.querySelector('[data-fk="whatsnew-ok"]') as HTMLElement;
    await act(async () => { ok.click(); });
    await new Promise((r) => setTimeout(r, 80));
    expect(whatsNew.value).toBeNull();
    expect(onTab).not.toHaveBeenCalled();
    expect(getCurrentFocusKey()).toBe('tile-1');
    expect(dialogRestoreKey('tab-history')).toBe('tile-1');
    render(null, host);
  });

  it('the automatic one waits for the player, update and pairing screens', () => {
    expect(shouldShowWhatsNew('library')).toBe(true);
    expect(shouldShowWhatsNew('player')).toBe(false);
    expect(shouldShowWhatsNew('update')).toBe(false);
    expect(shouldShowWhatsNew('pairPhone')).toBe(false);
  });
});

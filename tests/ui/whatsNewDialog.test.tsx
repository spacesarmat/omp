import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { WhatsNewDialog, shouldShowWhatsNew } from '../../src/ui/WhatsNewDialog';
import { whatsNew, closeWhatsNew } from '../../src/store/whatsNew';
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

  it('the automatic one waits for the player, update and pairing screens', () => {
    expect(shouldShowWhatsNew('library')).toBe(true);
    expect(shouldShowWhatsNew('player')).toBe(false);
    expect(shouldShowWhatsNew('update')).toBe(false);
    expect(shouldShowWhatsNew('pairPhone')).toBe(false);
  });
});

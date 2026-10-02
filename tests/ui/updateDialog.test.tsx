import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { UpdateDialog } from '../../src/ui/UpdateDialog';
import { updatePrompt, reloadUpdateState } from '../../src/store/updates';
import { routeStack } from '../../src/ui/nav';

const info = {
  version: '9.9.9', ipkUrl: 'https://x/a.ipk', ipkHash: 'd'.repeat(64), ipkSize: 0,
  notes: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], releaseUrl: 'https://x/r',
};

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(h(UpdateDialog, {}), host);
  await new Promise((r) => setTimeout(r, 0));
  return host;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => {
  localStorage.clear();
  reloadUpdateState();
  routeStack.value = [{ name: 'library' }];
  document.body.innerHTML = '';
});

describe('UpdateDialog', () => {
  it('renders nothing without a prompt', async () => {
    const host = await mount();
    expect(host.innerHTML).toBe('');
  });
  it('shows version, up to 8 notes and three actions', async () => {
    updatePrompt.value = info;
    const host = await mount();
    expect(host.querySelector('.dialog-title')!.textContent).toBe('Доступна версия 9.9.9');
    expect(host.querySelectorAll('.update-notes li')).toHaveLength(8);
    const labels = Array.prototype.map.call(host.querySelectorAll('.button'), (b: Element) => b.textContent);
    expect(labels).toEqual(['Обновить', 'Позже', 'Пропустить эту версию']);
  });
  it('«Обновить» opens the update screen, «Пропустить» remembers the version', async () => {
    updatePrompt.value = info;
    let host = await mount();
    (host.querySelectorAll('.button')[0] as HTMLElement).click();
    expect(updatePrompt.value).toBeNull();
    expect(routeStack.value[routeStack.value.length - 1]).toEqual({ name: 'update' });

    updatePrompt.value = info;
    host = await mount();
    (host.querySelectorAll('.button')[2] as HTMLElement).click();
    expect(updatePrompt.value).toBeNull();
    expect(JSON.parse(localStorage.getItem('tsp.update')!).skipped).toBe('9.9.9');
  });
});

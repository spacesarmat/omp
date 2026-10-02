import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { ConnectScreen } from '../../src/screens/Connect';
import { servers, activeServerId, addServer } from '../../src/store/servers';
import { mockFetch } from '../helpers/fetchMock';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  mockFetch(() => ({ body: 'MatriX.145.1' }));
});

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(h(ConnectScreen, {}), host);
  return host;
}

describe('ConnectScreen', () => {
  it('keeps the boot-check class and hides history without saved servers', () => {
    const host = mount();
    expect(host.querySelector('.screen.connect')).not.toBeNull();
    expect(host.querySelector('.history-btn')).toBeNull();
    expect(host.querySelectorAll('.connect-card input')).toHaveLength(1);
  });
  it('reveals login and password under «Дополнительно»', async () => {
    const host = mount();
    (host.querySelector('.link-toggle') as HTMLElement).click();
    await Promise.resolve();
    expect(host.querySelectorAll('.connect-card input')).toHaveLength(3);
  });
  it('opens the server history with a card per server and an edit dialog', async () => {
    addServer({ url: '192.168.1.191:5665', name: 'Дом' });
    addServer({ url: '10.0.0.12:8090', name: 'Дача' });
    const host = mount();
    expect(host.querySelector('.history-count')!.textContent).toBe('2');
    (host.querySelector('.history-btn') as HTMLElement).click();
    await Promise.resolve();
    const cards = host.querySelectorAll('.hist-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('.hist-name')!.textContent).toContain('Дом');
    (cards[1].querySelector('.button') as HTMLElement).click();
    await Promise.resolve();
    expect(host.querySelector('.edit-server .dialog-title')!.textContent).toBe('Изменить сервер');
    expect((host.querySelector('.edit-server input') as HTMLInputElement).value).toBe('Дача');
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { UpdateScreen } from '../../src/screens/Update';
import { latestUpdate } from '../../src/store/updates';

const info = {
  version: '9.9.9',
  ipkUrl: 'https://github.com/spacesarmat/omp/releases/download/v9.9.9/a.ipk',
  ipkHash: 'c'.repeat(64),
  ipkSize: 1,
  notes: ['Первое', 'Второе'],
  releaseUrl: 'https://github.com/spacesarmat/omp/releases/tag/v9.9.9',
};

function bridge(root: boolean, hb: 'installed' | 'missing') {
  (window as any).PalmServiceBridge = function (this: any) {
    this.call = (uri: string) => {
      let reply: object = { returnValue: true };
      if (uri.indexOf('checkRoot') >= 0) reply = { returnValue: root };
      if (uri.indexOf('getAppInfo') >= 0) reply = hb === 'installed' ? { returnValue: true, appInfo: {} } : { returnValue: false, errorText: 'app not exist' };
      setTimeout(() => this.onservicecallback(JSON.stringify(reply)), 0);
    };
  };
}

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(h(UpdateScreen, {}), host);
  await new Promise((r) => setTimeout(r, 20));
  return host;
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => undefined;
});
beforeEach(() => { latestUpdate.value = info; });
afterEach(() => { delete (window as any).PalmServiceBridge; document.body.innerHTML = ''; });

describe('UpdateScreen', () => {
  it('without root: no one-click install, Homebrew and computer blocks with QR', async () => {
    bridge(false, 'installed');
    const host = await mount();
    expect(host.textContent).toContain('доступна 9.9.9');
    expect(host.textContent).toContain('Первое');
    expect(host.textContent).not.toContain('Установить сейчас');
    expect(host.textContent).toContain('Открыть Homebrew Channel');
    expect(host.textContent).toContain('Добавить репозиторий OMP');
    expect(host.querySelectorAll('svg.qr')).toHaveLength(1);
  });
  it('with root: shows one-click install', async () => {
    bridge(true, 'installed');
    const host = await mount();
    expect(host.textContent).toContain('Установить сейчас');
    expect(Array.from(host.querySelectorAll('.button')).some((b) => b.textContent === 'Установить')).toBe(true);
  });
  it('without Homebrew Channel: explains and shows a QR to webosbrew.org', async () => {
    bridge(false, 'missing');
    const host = await mount();
    expect(host.textContent).toContain('Homebrew Channel не установлен');
    expect(host.textContent).not.toContain('Открыть Homebrew Channel');
    expect(host.querySelectorAll('svg.qr')).toHaveLength(2);
  });
  it('without a known update offers a manual check', async () => {
    latestUpdate.value = null;
    bridge(false, 'installed');
    const host = await mount();
    expect(host.textContent).toContain('Проверить обновления');
    expect(host.textContent).not.toContain('доступна');
  });
});

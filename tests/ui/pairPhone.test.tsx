import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, h } from 'preact';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { PairPhoneScreen } from '../../src/screens/PairPhone';
import { Qr } from '../../src/ui/Qr';
import { buildPairUri } from '../../src/lib/pairing';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
});

function mount(node: any) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(node, host);
  return host;
}

describe('PairPhoneScreen', () => {
  it('shows the server QR and the steps', () => {
    const s = addServer({ url: '192.168.1.191:5665', name: 'Дом', user: 'admin', password: 'p&s s' });
    setActiveServer(s.id);
    const host = mount(h(PairPhoneScreen, {}));
    const svg = host.querySelector('svg.qr') as SVGElement;
    expect(svg).not.toBeNull();
    const ref = mount(h(Qr, { text: buildPairUri({ url: s.url, name: s.name, user: 'admin', password: 'p&s s' }), size: 360 }));
    expect(svg.querySelector('path')!.getAttribute('d')).toBe(ref.querySelector('path')!.getAttribute('d'));
    expect(host.textContent).toContain('Сканировать QR с телевизора');
  });
  it('asks to connect first without a server', () => {
    const host = mount(h(PairPhoneScreen, {}));
    expect(host.querySelector('svg.qr')).toBeNull();
    expect(host.textContent).toContain('Сначала подключитесь к серверу');
  });
});

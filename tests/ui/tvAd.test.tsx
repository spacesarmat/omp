import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { TvAdCell, AdQrHost, closeAdQr } from '../../src/screens/library/TvAdCell';
import type { AdBanner } from '../../src/ads/ads';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  Element.prototype.scrollIntoView = () => undefined;
});

const banner: AdBanner = {
  id: 'abc123def456',
  title: 'Приставка',
  text: 'Скидка на выходные',
  advertiser: 'ООО Ромашка',
  erid: '2SDnjcVm1aB',
  url: 'https://shop.example/?erid=2SDnjcVm1aB',
  image: 'https://billing.example/v1/ads/img/' + 'a'.repeat(24),
  weight: 1,
  from: null,
  to: null,
  platforms: ['androidTv', 'webos'],
  sections: ['mine', 'discoverGrid'],
  tvMode: 'qr',
};

function mount(kind: 'large' | 'list' | 'compact' | 'disc', mode: AdBanner['tvMode'] = 'qr') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const b = { ...banner, tvMode: mode };
  render(
    h('div', null, h(TvAdCell, { kind, banner: b, focusKey: 'ad-1', onShown: () => undefined, onClick: () => undefined }), h(AdQrHost, null)),
    host,
  );
  return host;
}

afterEach(() => {
  closeAdQr();
  document.body.innerHTML = '';
});

describe('TV ad cell', () => {
  it('shows the label, the advertiser and the erid on a poster card', () => {
    const host = mount('large');
    const text = host.textContent || '';
    expect(text).toContain('Реклама');
    expect(text).toContain('ООО Ромашка');
    expect(text).toContain('erid: 2SDnjcVm1aB');
    expect(text).toContain('Приставка');
    expect(host.querySelector('.tile.ad-tile')).toBeTruthy();
  });

  it('opens a QR of the link', () => {
    const host = mount('disc');
    const tile = host.querySelector('.disc-tile') as HTMLElement;
    act(() => tile.click());
    const qr = host.querySelector('.ad-qr-card .qr');
    expect(qr).toBeTruthy();
    expect(qr!.getAttribute('aria-hidden')).toBe('true');
    expect(host.textContent).toContain('Наведите камеру телефона на код');
    expect(host.textContent).toContain('ООО Ромашка');
    expect(host.textContent).toContain('erid: 2SDnjcVm1aB');
  });

  it('a noclick banner is not a button and has no QR', () => {
    const host = mount('compact', 'noclick');
    expect(host.querySelector('.focusable')).toBeNull();
    expect(host.textContent).toContain('Реклама');
    expect(host.textContent).toContain('ООО Ромашка');
    expect(host.textContent).toContain('erid: 2SDnjcVm1aB');
    expect(host.querySelector('.ad-qr-card')).toBeNull();
  });
});

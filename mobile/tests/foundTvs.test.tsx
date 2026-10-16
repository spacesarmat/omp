import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FoundTvs, setFoundTvConnect, setFoundTvDiscoverer } from '../src/ui/FoundTvs';
import { activeTv, forgetTv, reloadTvs, tvs, type SavedTv } from '../src/tv/tvStore';

let el: HTMLElement;

function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<FoundTvs />, el));
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

afterEach(() => {
  act(() => render(null, el));
  setFoundTvDiscoverer(null, null);
  setFoundTvConnect(null);
  for (const tv of tvs.value.slice()) forgetTv(tv.ip);
  localStorage.clear();
  reloadTvs();
});

describe('discovered TVs', () => {
  it('renders nothing when discovery finds no TV', async () => {
    setFoundTvDiscoverer(async () => [], async () => []);
    mount();
    await flush();
    expect(el.querySelector('.m-found-tvs')).toBeNull();
  });

  it('connects a found LG TV in one tap', async () => {
    const seen: SavedTv[] = [];
    setFoundTvDiscoverer(
      async () => [{ ip: '192.168.1.9', name: 'LG OLED', model: 'OLED55' }],
      async () => [],
    );
    setFoundTvConnect((tv) => seen.push(tv));
    mount();
    await flush();
    expect(el.textContent).toContain('Телевизоры в сети');
    const button = el.querySelector('button.m-server') as HTMLButtonElement;
    expect(button.textContent).toContain('LG OLED');
    expect(button.textContent).toContain('OLED55');
    await act(async () => {
      button.click();
    });
    expect(seen.map((t) => t.ip)).toEqual(['192.168.1.9']);
    expect(seen[0].kind).toBe('lg');
    expect(activeTv.value?.ip).toBe('192.168.1.9');
  });

  it('asks for the code of a new Android TV', async () => {
    setFoundTvDiscoverer(async () => [], async () => [{ ip: '192.168.1.8', port: 8095, name: 'Гостиная', version: '0.20' }]);
    mount();
    await flush();
    const button = el.querySelector('button.m-server') as HTMLButtonElement;
    expect(button.textContent).toContain('Гостиная');
    await act(async () => {
      button.click();
    });
    expect(el.querySelector('.m-sheet')).not.toBeNull();
    expect(activeTv.value).toBeNull();
  });
});

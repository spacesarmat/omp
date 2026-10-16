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

  it('shows a TV found on another screen as soon as this one opens', async () => {
    let calls = 0;
    setFoundTvDiscoverer(
      async () => {
        calls += 1;
        return [{ ip: '192.168.1.9', name: 'LG OLED', model: 'OLED55' }];
      },
      async () => [],
    );
    mount();
    await flush();
    expect(el.textContent).toContain('LG OLED');

    // leave «Каталог» and open «Пульт» or «Настройки»: the same list, no second scan
    act(() => render(null, el));
    act(() => render(<FoundTvs />, el));
    expect(el.textContent).toContain('Телевизоры в сети');
    expect(el.textContent).toContain('LG OLED');
    expect(el.textContent).toContain('OLED55');
    expect(el.querySelector('.m-searching')).toBeNull();
    expect(calls).toBe(1);
  });

  it('shows searching instead of an empty block while the shared scan is running', async () => {
    let calls = 0;
    let release: (rows: { ip: string; name: string; model?: string }[]) => void = () => {};
    setFoundTvDiscoverer(
      () => {
        calls += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      async () => [],
    );
    mount();
    expect(el.textContent).toContain('Ищу…');
    expect(el.querySelector('button.m-server')).toBeNull();

    act(() => render(null, el));
    act(() => render(<FoundTvs />, el));
    expect(calls).toBe(1);
    expect(el.textContent).toContain('Ищу…');
    expect(el.querySelector('button.m-server')).toBeNull();

    await act(async () => {
      release([{ ip: '192.168.1.9', name: 'LG OLED', model: 'OLED55' }]);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(el.textContent).toContain('LG OLED');
    expect(el.querySelector('.m-searching')).toBeNull();
    expect(calls).toBe(1);
  });

  it('keeps a screen opened during the scan live when the other search finishes', async () => {
    let releaseAtv: (rows: { ip: string; port: number; name: string; version: string }[]) => void = () => {};
    setFoundTvDiscoverer(
      async () => [{ ip: '192.168.1.9', name: 'LG OLED', model: 'OLED55' }],
      () =>
        new Promise((resolve) => {
          releaseAtv = resolve;
        }),
    );
    mount();
    await flush();
    expect(el.textContent).toContain('LG OLED');
    expect(el.textContent).not.toContain('Гостиная');

    act(() => render(null, el));
    act(() => render(<FoundTvs />, el));
    expect(el.textContent).toContain('LG OLED');
    expect(el.querySelector('.m-searching')).toBeNull();

    await act(async () => {
      releaseAtv([{ ip: '192.168.1.8', port: 8095, name: 'Гостиная', version: '0.20' }]);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(el.textContent).toContain('LG OLED');
    expect(el.textContent).toContain('Гостиная');
    expect(el.textContent).toContain('OMP 0.20');
  });
});

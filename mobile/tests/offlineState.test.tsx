// QA S21 (B8, B9, B18): one honest «Нет интернета», and no TV search (or spinner) without Wi-Fi.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { CatalogError } from '../src/screens/catalog/CatalogError';
import { setOnlineForTest } from '../src/lib/online';
import { FoundTvs, setFoundTvDiscoverer } from '../src/ui/FoundTvs';
import { ensureFoundTvScan, foundTvNoWifi, foundTvScanning, setFoundTvWifi } from '../src/tv/foundTvDiscovery';

let el: HTMLElement;

function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

afterEach(() => {
  if (el) act(() => render(null, el));
  setOnlineForTest(null);
  setFoundTvDiscoverer(null, null);
});

describe('no internet', () => {
  it('the catalog error says «Нет интернета», not «TMDB не отвечает», and still offers a retry', () => {
    setOnlineForTest(false);
    mount(<CatalogError code="unreachable" onRetry={() => undefined} />);
    expect(el.textContent).toContain('Нет интернета');
    expect(el.textContent).not.toContain('TMDB');
    expect(el.textContent).toContain('Повторить');
  });

  it('online, the catalog error keeps its own text', () => {
    setOnlineForTest(true);
    mount(<CatalogError code="unreachable" onRetry={() => undefined} />);
    expect(el.textContent).not.toContain('Нет интернета');
  });
});

describe('TV search without Wi-Fi', () => {
  it('does not search and shows no «Ищу…»', async () => {
    const lg = vi.fn(async () => []);
    const atv = vi.fn(async () => []);
    setFoundTvDiscoverer(lg, atv);
    setFoundTvWifi(async () => false);
    mount(<FoundTvs />);
    ensureFoundTvScan();
    await flush();
    expect(lg).not.toHaveBeenCalled();
    expect(atv).not.toHaveBeenCalled();
    expect(foundTvNoWifi.value).toBe(true);
    expect(foundTvScanning.value).toBe(false);
    expect(el.textContent).not.toContain('Ищу');
  });

  it('on Wi-Fi it searches as before', async () => {
    const lg = vi.fn(async () => []);
    setFoundTvDiscoverer(lg, async () => []);
    setFoundTvWifi(() => true);
    mount(<FoundTvs />);
    await flush();
    expect(lg).toHaveBeenCalledTimes(1);
    expect(foundTvNoWifi.value).toBe(false);
  });

  it('«Каталог» (quiet): no searching line while the scan runs, so the grid does not move', () => {
    setFoundTvDiscoverer(() => new Promise(() => undefined), () => new Promise(() => undefined));
    setFoundTvWifi(() => true);
    mount(<FoundTvs quiet />);
    expect(foundTvScanning.value).toBe(true);
    expect(el.querySelector('.m-searching')).toBeNull();
    expect(el.innerHTML).toBe('');
  });
});

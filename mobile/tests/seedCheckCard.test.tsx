import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { saveBillingSession } from '../../src/billing/session';
import { applyLanguageSetting } from '../../src/i18n';
import { setDhtPeersContext } from '../../src/sources/dhtPeers';
import type { SourceHttp } from '../../src/sources/types';

vi.mock('../../src/sources/liveSeedsRun', async () => {
  const actual = await vi.importActual<typeof import('../../src/sources/liveSeedsRun')>('../../src/sources/liveSeedsRun');
  return { ...actual, probeSeeds: vi.fn(() => Promise.resolve({ ok: true, seeders: 12, leechers: 3 })) };
});

import { liveSeedCache } from '../../src/sources/liveSeeds';
import { probeSeeds } from '../../src/sources/liveSeedsRun';
import { useSeedRow } from '../../src/ui/LiveSeeds';
import { ResultCard, seedCheckable } from '../src/ui/ResultCard';
import type { SourceResult } from '../../src/sources/types';

const HASH = 'a'.repeat(40);
const MAGNET = 'magnet:?xt=urn:btih:' + HASH + '&tr=' + encodeURIComponent('udp://tracker.example.org:6969/announce');
const row = {
  Title: 'Американский папаша',
  Categories: '',
  Size: '114.1 GB',
  CreateDate: '',
  Tracker: 'rutor',
  Link: '',
  Magnet: MAGNET,
  Hash: HASH,
  Peer: 1,
  Seed: 3,
  source: 'rutor',
  date: new Date(2021, 9, 17).getTime(),
} as SourceResult;

let el: HTMLElement;

beforeEach(() => {
  applyLanguageSetting('ru');
  saveBillingSession(null);
  setDhtPeersContext(null);
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  vi.mocked(probeSeeds).mockReset();
  vi.mocked(probeSeeds).mockImplementation(() => Promise.resolve({ ok: true, seeders: 12, leechers: 3 }));
});

afterEach(() => {
  saveBillingSession(null);
  setDhtPeersContext(null);
  act(() => render(null, el));
});

describe('seed check on a result card', () => {
  it('sits left of add, at the action height, and a tap replaces the tracker count', async () => {
    const css = readFileSync('mobile/src/mobile.css', 'utf8');
    expect(css).toMatch(/\.seed-check\s*\{[^}]*background:\s*var\(--panel-2\)/);
    expect(css).toMatch(/\.seed-check\s*\{[^}]*color:\s*var\(--text\)/);
    expect(css).toMatch(/appearance:\s*none/);
    expect(css).toMatch(/\.m-rc-bottom \.seed-check \{[^}]*height:\s*40px/);
    expect(css).not.toMatch(/\.m-rc-bottom \.seed-check \{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.m-rc-sheet-actions \.m-sheet-row \.seed-check-short \{ display: inline; \}/);
    expect(css).toContain('@container rc (max-width: 250px)');
    const narrow = css.slice(css.indexOf('@media (max-width: 400px)'), css.indexOf('@media (max-width: 400px)') + 240);
    expect(narrow).toContain('.m-rc-bottom .seed-check-long { display: none; }');
    expect(narrow).toContain('.m-rc-bottom .seed-check-short { display: inline; }');
    expect(css).toMatch(/\.m-rc-bottom \{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.m-rc-bottom \{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.m-rc-text \{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.m-rc-bottom \.seed-check \{[^}]*flex:\s*0 1 auto/);
    expect(css).toMatch(/\.m-rc-bottom \.seed-check \{[^}]*min-width:\s*0/);

    act(() => render(<ResultCard r={row} category="tv" seedCode="P07.6" onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />, el));
    expect(el.querySelector('.m-rc-seed')).toBeNull();
    const bottom = el.querySelector('.m-rc-bottom')!;
    const btn = bottom.querySelector('.seed-check') as HTMLButtonElement;
    expect(btn).toBe(bottom.firstElementChild);
    expect(bottom.querySelector('.m-rc-btn')).toBe(btn.nextElementSibling);
    expect(btn.className).toContain('tm');
    expect(btn.getAttribute('data-code')).toBe('P07.6');
    expect(btn.querySelector('.seed-check-long')!.textContent).toBe('Проверить сиды');
    expect(btn.querySelector('.seed-check-short')!.textContent).toBe('Сиды');
    expect(bottom.querySelector('.m-rc-date')).toBeNull();
    expect(el.querySelector('.m-rc-meta .m-rc-date')!.textContent).toContain('окт');
    expect(el.querySelector('.m-rc-meta-text')!.textContent).toContain('3 сида');
    expect(el.querySelector('.m-rc-meta-text')!.textContent).not.toContain('по данным трекера');
    act(() => btn.click());
    expect(probeSeeds).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const meta = el.querySelector('.m-rc-meta-text')!.textContent || '';
    expect(meta).toContain('12 сидов');
    expect(meta).toContain('3 лича');
    expect(meta).not.toContain('по данным трекера');
    expect(btn.querySelector('.seed-check-long')!.textContent).toBe('Проверить сиды');
    act(() => (el.querySelector('.m-rc-open') as HTMLButtonElement).click());
    expect(el.querySelector('[data-result-details] .seed-check')).toBeNull();
    expect(el.querySelector('.m-result-meta .seed-check')).toBeNull();
    const sheetRow = el.querySelector('.m-rc-sheet-actions .m-sheet-row')!;
    const sheet = sheetRow.querySelector('.seed-check') as HTMLButtonElement;
    expect(sheet).toBe(sheetRow.firstElementChild);
    expect(el.querySelector('.m-rc-sheet-check')).toBeNull();
    expect(sheet.getAttribute('data-code')).toBe('PD31.1');
    expect(sheet.className).toContain('tm');
    expect(sheet.querySelector('.seed-check-short')!.textContent).toBe('Сиды');
    expect(sheet.querySelector('.seed-check-long')!.textContent).toBe('Проверить сиды');
    expect(el.querySelector('[data-result-details]')!.textContent).toContain('12 сидов');
    expect(el.querySelector('[data-result-details]')!.textContent).toContain('окт');
  });

  it('hides the button when the magnet has no tracker address and keeps the status', () => {
    const bare = { ...row, Magnet: 'magnet:?xt=urn:btih:' + HASH, Title: 'Anidub' };
    expect(seedCheckable(row)).toBe(true);
    expect(seedCheckable(bare)).toBe(false);
    act(() => render(<ResultCard r={bare} category="tv" onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />, el));
    expect(el.querySelector('.seed-check')).toBeNull();
    expect(el.querySelector('.m-rc-meta-text')!.textContent).toContain('Нет адреса трекера');
    expect(el.querySelector('.m-rc-meta-text')!.textContent).toContain('ГБ');
    act(() => (el.querySelector('.m-rc-open') as HTMLButtonElement).click());
    expect(el.querySelector('.seed-check')).toBeNull();
    expect(el.querySelector('[data-result-details]')!.textContent).toContain('Нет адреса трекера');
    expect(el.querySelector('.m-sheet-row')).toBeTruthy();
  });

  it('checks a release with no tracker address through DHT only when signed in', async () => {
    const bare = { ...row, Magnet: 'magnet:?xt=urn:btih:' + HASH, Title: 'Anidub' };
    saveBillingSession({ token: '', paidUntil: 1, access: 'a1.test', accessExp: Date.now() + 3600_000 });
    setDhtPeersContext(() => null);
    expect(seedCheckable(bare)).toBe(false);
    let seen = '';
    const http: SourceHttp = {
      get: (url) => {
        seen = url;
        return Promise.resolve({ status: 200, url, text: JSON.stringify({ peers: 4, source: 'dht', approx: true, estimate: true, seedsEstimate: 4 }) });
      },
      post: () => Promise.resolve({ status: 200, url: '', text: '' }),
      clearCookies: () => Promise.resolve(),
    };
    setDhtPeersContext(() => ({ http, client: null }));
    expect(seedCheckable(bare)).toBe(true);

    act(() => render(<ResultCard r={bare} category="tv" seedCode="P07.6" onPhone={() => {}} onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />, el));
    const bottom = el.querySelector('.m-rc-text .m-rc-bottom')!;
    const btn = bottom.querySelector('.seed-check') as HTMLButtonElement;
    expect(btn).toBe(bottom.firstElementChild);
    expect(bottom.querySelectorAll('.m-rc-btn').length).toBe(3);
    expect(btn.nextElementSibling!.classList.contains('m-rc-btn')).toBe(true);
    expect(btn.className).toContain('tm');
    expect(btn.getAttribute('data-code')).toBe('P07.6');
    expect(btn.querySelector('.seed-check-long')!.textContent).toBe('Проверить сиды');
    expect(btn.querySelector('.seed-check-short')!.textContent).toBe('Сиды');
    expect(el.querySelector('.m-rc-meta-text')!.textContent).toContain('3 сида');
    expect(el.querySelector('.m-rc-meta-text')!.textContent).not.toContain('по данным трекера');
    expect(el.querySelector('.m-rc-meta-text')!.textContent).not.toContain('Нет адреса трекера');
    act(() => btn.click());
    expect(probeSeeds).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const meta = el.querySelector('.m-rc-meta-text')!.textContent || '';
    expect(seen).toContain('/v1/dht-peers?infohash=' + HASH);
    expect(meta).toContain('Нет адреса трекера');
    expect(meta).toContain('~4 сида по DHT');
    expect(meta.indexOf('Нет адреса трекера')).toBeLessThan(meta.indexOf('~4 сида по DHT'));
    expect(meta).not.toContain('пир');
    expect(meta).not.toContain('сейчас');
    act(() => (el.querySelector('.m-rc-open') as HTMLButtonElement).click());
    const sheet = el.querySelector('.m-rc-sheet-actions .m-sheet-row .seed-check') as HTMLButtonElement;
    expect(sheet).toBe(el.querySelector('.m-rc-sheet-actions .m-sheet-row')!.firstElementChild);
    expect(sheet.getAttribute('data-code')).toBe('PD31.1');
    expect(el.querySelector('[data-result-details]')!.textContent).toContain('Нет адреса трекера');
    expect(el.querySelector('[data-result-details]')!.textContent).toContain('~4 сида по DHT');
  });

  it('shows the tracker count before the DHT estimate arrives', async () => {
    let releaseDht: (v: { status: number; url: string; text: string }) => void = () => undefined;
    const http: SourceHttp = {
      get: (url) =>
        new Promise((resolve) => {
          releaseDht = resolve;
        }),
      post: () => Promise.resolve({ status: 200, url: '', text: '' }),
      clearCookies: () => Promise.resolve(),
    };
    saveBillingSession({ token: '', paidUntil: 1, access: 'a1.test', accessExp: Date.now() + 3600_000 });
    setDhtPeersContext(() => ({ http, client: null }));
    let releaseTracker: (v: { ok: true; seeders: number; leechers: number }) => void = () => undefined;
    vi.mocked(probeSeeds).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseTracker = resolve;
        }),
    );

    act(() => render(<ResultCard r={row} category="tv" onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />, el));
    act(() => (el.querySelector('.m-rc-bottom .seed-check') as HTMLButtonElement).click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(el.querySelector('.m-rc-meta-text')!.textContent).toContain('3 сида');
    expect(el.querySelector('.m-rc-meta-text')!.textContent).not.toContain('по данным трекера');
    expect(el.querySelector('.m-rc-meta-text')!.textContent).not.toContain('сейчас');

    await act(async () => {
      releaseTracker({ ok: true, seeders: 12, leechers: 3 });
      await Promise.resolve();
      await Promise.resolve();
    });
    let meta = el.querySelector('.m-rc-meta-text')!.textContent || '';
    expect(meta).toContain('3 сида');
    expect(meta).not.toContain('по данным трекера');
    expect(meta).not.toContain('сейчас');
    expect(meta).not.toContain('по DHT');

    await act(async () => {
      releaseDht({ status: 200, url: '', text: JSON.stringify({ peers: 9, source: 'dht', approx: true, estimate: true, seedsEstimate: 6 }) });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    meta = el.querySelector('.m-rc-meta-text')!.textContent || '';
    expect(meta).toContain('12 сидов');
    expect(meta).toContain('сейчас');
    expect(meta).not.toContain('по DHT');
    expect(meta).not.toContain('пир');
  });

  it('says DHT needs an OMP subscription when the tracker fails and there is no session', async () => {
    let calls = 0;
    const http: SourceHttp = {
      get: () => {
        calls += 1;
        return Promise.resolve({ status: 200, url: '', text: '' });
      },
      post: () => Promise.resolve({ status: 200, url: '', text: '' }),
      clearCookies: () => Promise.resolve(),
    };
    setDhtPeersContext(() => ({ http, client: null }));
    vi.mocked(probeSeeds).mockImplementation(() => Promise.resolve({ ok: false, reason: 'timeout' }));
    act(() => render(<ResultCard r={row} category="tv" onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />, el));
    act(() => (el.querySelector('.m-rc-bottom .seed-check') as HTMLButtonElement).click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const meta = el.querySelector('.m-rc-meta-text')!.textContent || '';
    expect(meta).toContain('Трекер не ответил');
    expect(meta).toContain('Проверка по DHT - с подпиской OMP');
    expect(meta).not.toContain('пир');
    expect(calls).toBe(0);
    setDhtPeersContext(() => null);
    act(() => (el.querySelector('.m-rc-bottom .seed-check') as HTMLButtonElement).click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const webos = el.querySelector('.m-rc-meta-text')!.textContent || '';
    expect(webos).toContain('Трекер не ответил');
    expect(webos).not.toContain('Проверка по DHT');
  });

  function CacheProbe(p: { active?: boolean }) {
    const live = useSeedRow(row, p.active);
    return <div data-mode={live.view.mode} ref={live.bind} />;
  }

  it('does not read the device scrape when the search round owns the row', () => {
    liveSeedCache.put(HASH, { seeders: 9, leechers: 2, live: true, at: Date.now() });
    act(() => render(<CacheProbe active={false} />, el));
    expect(el.querySelector('[data-mode]')!.getAttribute('data-mode')).toBe('off');
    act(() => render(<CacheProbe />, el));
    expect(el.querySelector('[data-mode]')!.getAttribute('data-mode')).toBe('live');
    liveSeedCache.forget(HASH);
  });

  it('drops the live dot when a later manual check is not a tracker count', async () => {
    const http: SourceHttp = {
      get: () => Promise.resolve({ status: 200, url: '', text: JSON.stringify({ peers: 4, source: 'dht', approx: true, estimate: true, seedsEstimate: 4 }) }),
      post: () => Promise.resolve({ status: 200, url: '', text: '' }),
      clearCookies: () => Promise.resolve(),
    };
    saveBillingSession({ token: '', paidUntil: 1, access: 'a1.test', accessExp: Date.now() + 3600_000 });
    setDhtPeersContext(() => ({ http, client: null }));
    vi.mocked(probeSeeds).mockImplementation(() => Promise.resolve({ ok: false, reason: 'timeout' }));
    const live = { ...row, Seed: 4, Peer: 1, seedCheck: 'live' as const };
    act(() => render(<ResultCard r={live} category="tv" round onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />, el));
    expect(el.querySelector('.seed-live')).toBeTruthy();
    act(() => (el.querySelector('.m-rc-bottom .seed-check') as HTMLButtonElement).click());
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    const meta = el.querySelector('.m-rc-meta-text')!.textContent || '';
    expect(meta).toContain('~4 сида по DHT');
    expect(meta).not.toContain('пир');
    expect(meta).not.toContain('сейчас');
    expect(el.querySelector('.seed-live')).toBeNull();
    act(() => (el.querySelector('.m-rc-open') as HTMLButtonElement).click());
    expect(el.querySelector('[data-result-details] .seed-live')).toBeNull();
    expect(el.querySelector('[data-result-details]')!.textContent).toContain('~4 сида по DHT');
  });

  it('shows the server round instead of a raw zero and keeps one manual line', () => {
    const checked = { ...row, Seed: 0, Peer: 0, seedCheck: 'unverified' as const };
    act(() => render(<ResultCard r={checked} category="tv" round onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />, el));
    const meta = el.querySelector('.m-rc-meta-text')!.textContent || '';
    expect(meta).toContain('не проверено');
    expect(meta).not.toContain('0 сидов');
    const live = { ...row, Seed: 4, Peer: 1, seedCheck: 'live' as const, dhtPeers: 2 };
    act(() => render(<ResultCard r={live} category="tv" round onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />, el));
    const again = el.querySelector('.m-rc-meta-text')!.textContent || '';
    expect(again).toContain('4 сида');
    expect(again).toContain('1 лич');
    expect(again).toContain('сейчас');
    expect(again).not.toContain('пир');
    expect(again).not.toContain('по данным трекера');
    expect(el.querySelector('.seed-live')).toBeTruthy();
  });

  it('English short label is Seeds', () => {
    applyLanguageSetting('en');
    act(() => render(<ResultCard r={row} category="tv" onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />, el));
    const btn = el.querySelector('.m-rc-bottom .seed-check')!;
    expect(btn.querySelector('.seed-check-long')!.textContent).toBe('Check seeds');
    expect(btn.querySelector('.seed-check-short')!.textContent).toBe('Seeds');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';

vi.mock('../../src/sources/liveSeedsRun', async () => {
  const actual = await vi.importActual<typeof import('../../src/sources/liveSeedsRun')>('../../src/sources/liveSeedsRun');
  return { ...actual, probeSeeds: vi.fn(() => Promise.resolve({ ok: true, seeders: 12, leechers: 3 })) };
});

import { probeSeeds } from '../../src/sources/liveSeedsRun';
import { ResultCard } from '../src/ui/ResultCard';
import type { SourceResult } from '../../src/sources/types';

const row = {
  Title: 'Американский папаша',
  Categories: '',
  Size: '114.1 GB',
  CreateDate: '',
  Tracker: 'rutor',
  Link: '',
  Magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40),
  Hash: 'a'.repeat(40),
  Peer: 1,
  Seed: 3,
  source: 'rutor',
  date: new Date(2021, 9, 17).getTime(),
} as SourceResult;

let el: HTMLElement;

beforeEach(() => {
  applyLanguageSetting('ru');
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  vi.mocked(probeSeeds).mockClear();
});

afterEach(() => {
  act(() => render(null, el));
});

describe('seed check on a result card', () => {
  it('is a labeled chip, and a tap replaces the tracker count', async () => {
    const css = readFileSync('mobile/src/mobile.css', 'utf8');
    expect(css).toMatch(/\.seed-check\s*\{[^}]*background:\s*var\(--panel-2\)/);
    expect(css).toMatch(/\.seed-check\s*\{[^}]*color:\s*var\(--text\)/);
    expect(css).toMatch(/appearance:\s*none/);

    act(() => render(<ResultCard r={row} category="tv" onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />, el));
    const btn = el.querySelector('.m-rc-bottom .seed-check') as HTMLButtonElement;
    expect(btn.textContent).toBe('Проверить сиды');
    expect(el.querySelector('.m-rc-meta-text')!.textContent).toContain('по данным трекера');
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
    expect(btn.textContent).toBe('Проверить сиды');
    act(() => (el.querySelector('.m-rc-open') as HTMLButtonElement).click());
    const sheet = el.querySelector('[data-result-details] .seed-check') as HTMLButtonElement;
    expect(sheet.textContent).toBe('Проверить сиды');
    expect(el.querySelector('[data-result-details]')!.textContent).toContain('12 сидов');
  });
});

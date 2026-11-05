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
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  vi.mocked(probeSeeds).mockClear();
});

afterEach(() => {
  act(() => render(null, el));
});

describe('seed check on a result card', () => {
  it('sits left of add, at the action height, and a tap replaces the tracker count', async () => {
    const css = readFileSync('mobile/src/mobile.css', 'utf8');
    expect(css).toMatch(/\.seed-check\s*\{[^}]*background:\s*var\(--panel-2\)/);
    expect(css).toMatch(/\.seed-check\s*\{[^}]*color:\s*var\(--text\)/);
    expect(css).toMatch(/appearance:\s*none/);
    expect(css).toMatch(/\.m-rc-bottom \.seed-check,\s*\.m-rc-sheet-check \.seed-check\s*\{[^}]*height:\s*40px/);
    expect(css).toContain('@container rc (max-width: 250px)');
    expect(css).toContain('.m-rc-bottom .seed-check-short { display: inline; }');

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
    expect(btn.querySelector('.seed-check-long')!.textContent).toBe('Проверить сиды');
    act(() => (el.querySelector('.m-rc-open') as HTMLButtonElement).click());
    expect(el.querySelector('[data-result-details] .seed-check')).toBeNull();
    expect(el.querySelector('.m-result-meta .seed-check')).toBeNull();
    const sheet = el.querySelector('.m-rc-sheet-check .seed-check') as HTMLButtonElement;
    expect(sheet.getAttribute('data-code')).toBe('PD31.1');
    expect(sheet.className).toContain('tm');
    expect(sheet.querySelector('.seed-check-long')!.textContent).toBe('Проверить сиды');
    const actions = el.querySelector('.m-rc-sheet-actions')!;
    expect(actions.firstElementChild).toBe(sheet.parentElement);
    expect(actions.querySelector('.m-sheet-row')).toBe(sheet.parentElement!.nextElementSibling);
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

  it('English short label is Seeds', () => {
    applyLanguageSetting('en');
    act(() => render(<ResultCard r={row} category="tv" onCategory={() => {}} onAdd={() => {}} onWatch={() => {}} />, el));
    const btn = el.querySelector('.m-rc-bottom .seed-check')!;
    expect(btn.querySelector('.seed-check-long')!.textContent).toBe('Check seeds');
    expect(btn.querySelector('.seed-check-short')!.textContent).toBe('Seeds');
  });
});

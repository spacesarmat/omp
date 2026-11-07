import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { ResultCard } from '../src/ui/ResultCard';
import type { SourceResult } from '../../src/sources/types';

const nnm = {
  Title: 'Film 2160p DV BluRay',
  Categories: '',
  Size: '28.7 GB',
  CreateDate: '',
  Tracker: 'NNM-Club',
  Link: '',
  Magnet: '',
  Hash: '',
  Peer: 1,
  Seed: 4,
  source: 'nnm-menu',
  detailUrl: 'https://nnmclub.to/forum/viewtopic.php?t=9',
} as SourceResult;

let el: HTMLElement;

beforeEach(() => {
  applyLanguageSetting('ru');
  registerSource({ id: 'nnm-menu', name: 'NNM-Club', kind: 'builtin', search: async () => [], magnet: async () => 'magnet:?xt=urn:btih:' + 'cd'.repeat(20) });
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
});

afterEach(() => {
  unregisterSource('nnm-menu');
  act(() => render(null, el));
});

describe('feed card menu', () => {
  it('a tap opens the action menu; add does not open it and does not bubble', () => {
    let added = 0;
    let parent = 0;
    act(() =>
      render(
        <div onClick={() => parent++}>
          <ResultCard r={nnm} menu category="movie" onCategory={() => {}} onAdd={() => added++} onWatch={() => {}} />
        </div>,
        el,
      ),
    );
    expect(el.textContent).not.toContain('Нет адреса трекера');
    act(() => (el.querySelector('.m-rc-btn') as HTMLButtonElement).click());
    expect(added).toBe(1);
    expect(parent).toBe(0);
    expect(el.querySelector('[data-result-menu]')).toBeNull();
    act(() => (el.querySelector('.m-rc-open') as HTMLButtonElement).click());
    expect(el.querySelector('[data-result-menu]')).toBeTruthy();
    expect(el.querySelector('[data-result-menu]')!.textContent).toContain('Открыть на сайте');
    expect(added).toBe(1);
  });
});

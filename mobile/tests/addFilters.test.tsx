import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { applyLanguageSetting } from '../../src/i18n';
import { Add, resetAddSearch } from '../src/screens/Add';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrents } from '../../src/store/library';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth, setSourceOn } from '../../src/sources/store';
import { loadSubs } from '../../src/monitor/subs';
import type { SourceResult } from '../../src/sources/types';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

let el: HTMLElement;

function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(<Add />, el));
}

function unmount() {
  act(() => render(null, el));
}

function row(p: Partial<SourceResult>): SourceResult {
  return { Title: 'Северный ветер 2026', Categories: '', Size: '10 GB', CreateDate: '', Tracker: 'F', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 10, source: 'fake', ...p };
}

const rows = [
  row({ Title: 'Северный ветер 2026 WEB-DL 1080p | Дубляж', Seed: 400, detailUrl: 'https://f.example/1' }),
  row({ Title: 'Северный ветер 2026 2160p HDR | MVO', Seed: 60, detailUrl: 'https://f.example/2' }),
  row({ Title: 'Северный ветер 2026 CAMRip', Seed: 900, detailUrl: 'https://f.example/3' }),
];

const buttons = (root: ParentNode = el) => Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
const click = (n: Element) => act(() => (n as HTMLElement).click());
const filtersChip = () => buttons().find((b) => b.getAttribute('aria-haspopup') === 'dialog' && /^(Фильтры|Filters)/.test(b.textContent || ''))!;
const sheetBtn = (text: string) => buttons(el.querySelector('.m-sheet')!).find((b) => b.textContent === text)!;
const titles = () => Array.from(el.querySelectorAll('.m-result-title')).map((n) => n.textContent);

function search(q: string) {
  const i = el.querySelector('input[type=search]') as HTMLInputElement;
  act(() => {
    i.value = q;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function mountAndSearch() {
  mount();
  search('северный ветер');
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  resetAddSearch();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [];
  setSourceOn('ts-rutor', false);
  setSourceOn('ts-torznab', false);
  registerSource({ id: 'fake', name: 'Фейк', kind: 'builtin', search: () => Promise.resolve(rows) });
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
});

afterEach(() => {
  if (el) act(() => render(null, el));
  unregisterSource('fake');
  vi.restoreAllMocks();
});

describe('Add filters sheet', () => {
  it('«Фильтры · N» opens the sheet; choices filter the rows and show as chips', async () => {
    await mountAndSearch();
    expect(titles().length).toBe(3);
    click(filtersChip());
    expect(el.querySelector('.m-sheet')!.getAttribute('aria-label')).toBe('Фильтры');
    click(sheetBtn('1080p'));
    click(sheetBtn('Скрыть экранки'));
    expect(sheetBtn('Показать 1 раздачу')).toBeTruthy();
    click(sheetBtn('Показать 1 раздачу'));
    expect(el.querySelector('.m-sheet')).toBeNull();
    expect(titles()).toEqual(['Северный ветер 2026 WEB-DL 1080p | Дубляж']);
    const chips = Array.from(el.querySelectorAll('.m-chip-static')).map((c) => c.textContent);
    expect(chips).toEqual(['1080p', 'без экранок']);
    expect(filtersChip().textContent).toBe('Фильтры · 2');
  });

  it('filters persist across mounts (tsp.searchFilters)', async () => {
    await mountAndSearch();
    click(filtersChip());
    click(sheetBtn('1080p'));
    click(sheetBtn('Показать 2 раздачи'));
    expect(JSON.parse(localStorage.getItem('tsp.searchFilters')!).res).toEqual([1080]);
    unmount();
    resetAddSearch();
    mount();
    expect(filtersChip().textContent).toBe('Фильтры · 1');
  });

  it('«Сбросить» clears every group', async () => {
    await mountAndSearch();
    click(filtersChip());
    click(sheetBtn('1080p'));
    click(sheetBtn('Скрыть экранки'));
    expect(filtersChip().textContent).toBe('Фильтры · 2');
    click(sheetBtn('Сбросить'));
    expect(filtersChip().textContent).toBe('Фильтры');
    expect(el.querySelectorAll('.m-chip-static').length).toBe(0);
    click(el.querySelector('.m-sheet-backdrop')!);
    expect(titles().length).toBe(3);
  });

  it('the «Подписаться» plate takes the quality from the filters', async () => {
    mount();
    click(filtersChip());
    click(sheetBtn('4K'));
    click(el.querySelector('.m-sheet-backdrop')!);
    search('северный ветер');
    await flush();
    const plate = el.querySelector('[data-plate="subscribe"]')!;
    click(buttons(plate).find((b) => b.textContent === 'Подписаться')!);
    click(buttons(el.querySelector('.m-sheet')!).find((b) => b.textContent === 'Сохранить')!);
    expect(loadSubs()[0].quality).toBe('2160');
  });

  it('shows English labels', async () => {
    applyLanguageSetting('en');
    try {
      await mountAndSearch();
      click(filtersChip());
      expect(el.querySelector('.m-sheet')!.getAttribute('aria-label')).toBe('Filters');
      click(sheetBtn('Hide camrips'));
      expect(sheetBtn('Show 2 torrents')).toBeTruthy();
      click(sheetBtn('Reset'));
      click(sheetBtn('Hide camrips'));
      click(el.querySelector('.m-sheet-backdrop')!);
      expect(filtersChip().textContent).toBe('Filters · 1');
      expect(el.querySelector('.m-chip-static')!.textContent).toBe('no camrips');
    } finally {
      applyLanguageSetting('ru');
    }
  });
});

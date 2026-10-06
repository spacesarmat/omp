import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
import { tvGlyphs } from '../../src/ui/tvText';
import { TorrentScreen } from '../../src/screens/Torrent';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

describe('tvGlyphs', () => {
  it('has no invisible literals in its source', () => {
    const src: string = readFileSync('src/ui/tvText.ts', 'utf8');
    // anything outside printable ASCII
    const bad = src.split('').filter((c) => c.charCodeAt(0) > 126);
    expect(bad.map((c) => c.charCodeAt(0).toString(16))).toEqual([]);
  });

  it('keeps the old swaps', () => {
    expect(tvGlyphs('Wi\u2011Fi \u2010 CH\u2212')).toBe('Wi-Fi - CH-');
    expect(tvGlyphs('a\u2009b\u200Ac\u202Fd')).toBe('a b c d');
    expect(tvGlyphs('a\u00ADb\u200Bc\u2060d')).toBe('abcd');
  });

  it('turns a symbol between words into one space (the real LG sample)', () => {
    const name = 'Повелитель духов 1-2 серия [4K] \u25B8 Заклинатели духов [-235953120 456239231].mkv';
    expect(tvGlyphs(name)).toBe('Повелитель духов 1-2 серия [4K] Заклинатели духов [-235953120 456239231].mkv');
    expect(tvGlyphs('Movie\u2758Name')).toBe('Movie Name');
    expect(tvGlyphs('Movie \u2756 \u2605 Name')).toBe('Movie Name');
    expect(tvGlyphs('Фильм\u2764\uFE0F 2024')).toBe('Фильм 2024');
    expect(tvGlyphs('Кино \uD83C\uDFAC Ночь')).toBe('Кино Ночь');
    expect(tvGlyphs('\uD83D\uDD25 Hot \u2600')).toBe('Hot');
    expect(tvGlyphs('A\u200D\uFE0FB')).toBe('AB');
  });

  it('keeps the shapes the UI draws and plain text', () => {
    expect(tvGlyphs('\u25A0 \u25CF \u25B2 \u25BC \u25C0 \u25B6')).toBe('\u25A0 \u25CF \u25B2 \u25BC \u25C0 \u25B6');
    expect(tvGlyphs('Обычное имя [1080p] - S01E01 \u2192 ok')).toBe('Обычное имя [1080p] - S01E01 \u2192 ok');
  });
});

const H = 'f'.repeat(40);
const tor: Torrent = {
  hash: H,
  title: 'Повелитель духов [4K] \u25B8 Заклинатели духов',
  stat: 3,
  file_stats: [1, 2].map((i) => ({ id: i, path: 'Сезон/Серия ' + i + ' \u2758 name.mkv', length: 1e9 })),
};
const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
let host: HTMLElement;

describe('TV torrent screen', () => {
  beforeEach(async () => {
    localStorage.clear();
    for (const s of servers.value.slice()) removeServer(s.id);
    setActiveServer(addServer({ url: 'http://srv:8090' }).id);
    torrents.value = [tor];
    vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(tor);
    vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
    host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(h(TorrentScreen, { hash: H }), host));
    await flush();
  });
  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    vi.restoreAllMocks();
  });

  it('shows no symbols the TV font lacks in the title and file rows', () => {
    expect(host.querySelector('h1')!.textContent).toBe('Повелитель духов [4K] Заклинатели духов');
    const names = Array.prototype.slice.call(host.querySelectorAll('.file-row .name')).map((e: Element) => e.textContent);
    expect(names.length).toBe(2);
    names.forEach((n: string | null) => expect(n).not.toMatch(/[\u2758\u25B8]/));
  });

  it('keeps the action buttons in one row that scrolls sideways to the focused one', async () => {
    const box = host.querySelector('.torrent-actions') as HTMLElement;
    const row = host.querySelector('.torrent-actions-row') as HTMLElement;
    expect(box && row && box.contains(row)).toBe(true);
    const keys = Array.prototype.slice.call(row.querySelectorAll('[data-fk]')).map((e: Element) => e.getAttribute('data-fk') as string);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    // no layout in the test DOM: 300px per button (316 apart) in a 1000px box
    const fix = (el: Element, props: Record<string, any>) => Object.keys(props).forEach((k) => Object.defineProperty(el, k, { configurable: true, ...props[k] }));
    keys.forEach((k, i) => fix(row.querySelector('[data-fk="' + k + '"]')!, { offsetLeft: { get: () => i * 316 }, offsetWidth: { get: () => 300 } }));
    let scroll = 0;
    fix(box, { clientWidth: { get: () => 1000 }, scrollLeft: { get: () => scroll, set: (v: number) => { scroll = v; } } });
    {
      const last = keys[keys.length - 1];
      await act(async () => { setFocus(last); await new Promise((r) => setTimeout(r, 50)); });
      const start = (keys.length - 1) * 316;
      expect(box.scrollLeft).toBe(start + 300 + 24 - 1000);
      await act(async () => { setFocus(keys[0]); await new Promise((r) => setTimeout(r, 50)); });
      expect(box.scrollLeft).toBe(0);
    }
  });
});

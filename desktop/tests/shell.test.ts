import { describe, expect, it } from 'vitest';
import { desktopHotkey } from '../../mobile/src/desktop/hotkeys';
import { linksFromDrop, magnetFromText } from '../../mobile/src/desktop/drop';
import { nextSidebarMode, readSidebarMode, sidebarIsNarrow, sidebarShortcut, writeSidebarMode } from '../../mobile/src/desktop/sidebarState';
import { wheelToRow } from '../../mobile/src/desktop/wheel';

function key(init: KeyboardEventInit & { key: string }, target?: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('desktop sidebar', () => {
  it('cycles expanded, rail and hidden and remembers the choice', () => {
    expect(nextSidebarMode('expanded')).toBe('rail');
    expect(nextSidebarMode('rail')).toBe('hidden');
    expect(nextSidebarMode('hidden')).toBe('expanded');
    const store = new Map<string, string>();
    const storage = {
      getItem: (name: string) => store.get(name) ?? null,
      setItem: (name: string, value: string) => void store.set(name, value),
    };
    expect(readSidebarMode(storage)).toBe('expanded');
    writeSidebarMode(storage, 'rail');
    expect(readSidebarMode(storage)).toBe('rail');
    expect(sidebarIsNarrow(800)).toBe(true);
    expect(sidebarIsNarrow(1280)).toBe(false);
    expect(sidebarShortcut({ key: 'b', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(sidebarShortcut({ key: 'b', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe(true);
    expect(sidebarShortcut({ key: 'b', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false })).toBe(false);
  });
});

describe('desktop hotkeys', () => {
  it('maps playback, search and back, and leaves text fields alone', () => {
    expect(desktopHotkey(key({ key: ' ' }))).toBe('play-pause');
    expect(desktopHotkey(key({ key: 'ArrowLeft' }))).toBe('seek-back');
    expect(desktopHotkey(key({ key: 'ArrowRight' }))).toBe('seek-forward');
    expect(desktopHotkey(key({ key: 'ArrowUp' }))).toBe('volume-up');
    expect(desktopHotkey(key({ key: 'ArrowDown' }))).toBe('volume-down');
    expect(desktopHotkey(key({ key: 'f' }))).toBe('fullscreen');
    expect(desktopHotkey(key({ key: 'k', ctrlKey: true }))).toBe('search');
    expect(desktopHotkey(key({ key: 'k', metaKey: true }))).toBe('search');
    expect(desktopHotkey(key({ key: 'Escape' }))).toBe('back');
    const input = document.createElement('input');
    expect(desktopHotkey(key({ key: ' ' }, input))).toBeNull();
    expect(desktopHotkey(key({ key: 'Escape' }, input))).toBe('back');
  });
});

describe('desktop wheel and drop', () => {
  it('scrolls a wide row with the wheel and ignores a short one', () => {
    const row = document.createElement('div');
    row.className = 'm-disc-rail-row';
    Object.defineProperty(row, 'scrollWidth', { value: 800, configurable: true });
    Object.defineProperty(row, 'clientWidth', { value: 200, configurable: true });
    row.scrollLeft = 0;
    const child = document.createElement('span');
    row.append(child);
    let prevented = false;
    expect(wheelToRow({ target: child, deltaX: 0, deltaY: 40, preventDefault: () => { prevented = true; } })).toBe(true);
    expect(row.scrollLeft).toBe(40);
    expect(prevented).toBe(true);
    Object.defineProperty(row, 'scrollWidth', { value: 100, configurable: true });
    expect(wheelToRow({ target: child, deltaX: 0, deltaY: 40, preventDefault() {} })).toBe(false);
  });

  it('accepts a magnet and a torrent file', () => {
    expect(magnetFromText('see magnet:?xt=urn:btih:' + 'ab'.repeat(20) + ' now')).toContain('magnet:?xt=urn:btih:');
    const links = linksFromDrop('magnet:?xt=urn:btih:' + 'cd'.repeat(20), [{ name: 'Show.torrent', bytes: new Uint8Array([1, 2, 3]) }]);
    expect(links[0]).toContain('magnet:');
    expect(links[1]).toMatch(/^omp-file:/);
    expect(linksFromDrop('hello', [{ name: 'notes.txt', bytes: new Uint8Array([1]) }])).toEqual([]);
  });
});

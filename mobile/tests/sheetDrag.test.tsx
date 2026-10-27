import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
// @ts-ignore node builtins
import { readdirSync, readFileSync, statSync } from 'node:fs';
// @ts-ignore
import { join, resolve } from 'node:path';
import { applyLanguageSetting } from '../../src/i18n';
import { Sheet } from '../src/ui/Sheet';
import {
  SHEET_DISMISS_DY,
  SHEET_DRAG_SLOP,
  beginSheetDrag,
  moveSheetDrag,
  sheetDragDismisses,
  sheetListScrolled,
} from '../src/ui/sheetDrag';

function mount(onClose: () => void, listScroll = 0) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  act(() => {
    render(
      <Sheet label="Find better" onClose={onClose}>
        <div class="m-sheet-title">Find a better copy</div>
        <div class="m-sheet-scroll" data-list="">
          <p>row</p>
        </div>
      </Sheet>,
      el,
    );
  });
  const list = el.querySelector('[data-list]') as HTMLElement;
  list.scrollTop = listScroll;
  return el;
}

function touch(target: Element, type: string, y: number, x = 30) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y, identifier: 1 };
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [point] });
  Object.defineProperty(ev, 'changedTouches', { value: [point] });
  target.dispatchEvent(ev);
}

function pull(target: Element, from: number, to: number) {
  touch(target, 'touchstart', from);
  touch(target, 'touchmove', from + SHEET_DRAG_SLOP + 4);
  touch(target, 'touchmove', to);
  touch(target, 'touchend', to);
}

afterEach(() => {
  applyLanguageSetting('ru');
  document.body.innerHTML = '';
});

describe('sheet drag decision', () => {
  it('follows a downward pull from the top and ignores a scrolled list', () => {
    const start = beginSheetDrag(100, 20);
    const nudged = moveSheetDrag(start, 100 + SHEET_DRAG_SLOP + 2, 20, false, false);
    expect(nudged.latched).toBe(true);
    const pulled = moveSheetDrag(nudged, 100 + SHEET_DISMISS_DY + 30, 22, false, false);
    expect(pulled.offset).toBeGreaterThanOrEqual(SHEET_DISMISS_DY);
    expect(sheetDragDismisses(pulled.offset)).toBe(true);

    const scrolled = moveSheetDrag(start, 240, 20, true, false);
    expect(scrolled.latched).toBe(false);
    expect(scrolled.offset).toBe(0);

    const grip = moveSheetDrag(start, 140, 20, true, true);
    expect(grip.latched).toBe(true);
  });

  it('does not latch on an upward or sideways move, and a short pull does not dismiss', () => {
    const start = beginSheetDrag(200, 40);
    expect(moveSheetDrag(start, 160, 40, false, false).latched).toBe(false);
    expect(moveSheetDrag(start, 230, 120, false, false).latched).toBe(false);
    expect(sheetDragDismisses(SHEET_DISMISS_DY - 1)).toBe(false);
  });

  it('treats a scroller below its top as still in the list', () => {
    const sheet = document.createElement('div');
    const list = document.createElement('div');
    const row = document.createElement('p');
    sheet.append(list);
    list.append(row);
    document.body.append(sheet);
    list.scrollTop = 40;
    expect(sheetListScrolled(sheet, row)).toBe(true);
    list.scrollTop = 0;
    expect(sheetListScrolled(sheet, row)).toBe(false);
    sheet.scrollTop = 12;
    expect(sheetListScrolled(sheet, row)).toBe(true);
  });
});

describe('Sheet grab handle and pull', () => {
  it('labels the handle «Закрыть» / Close and a tap closes', () => {
    const onClose = vi.fn();
    const el = mount(onClose);
    const grip = el.querySelector('.m-sheet-grip') as HTMLButtonElement;
    expect(grip.tagName).toBe('BUTTON');
    expect(grip.getAttribute('aria-label')).toBe('Закрыть');
    act(() => grip.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    applyLanguageSetting('en');
    const again = vi.fn();
    const en = mount(again);
    expect(en.querySelector('.m-sheet-grip')!.getAttribute('aria-label')).toBe('Close');
    expect(en.innerHTML).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('a pull from the top of the list dismisses past the threshold and a short pull does not', () => {
    const onClose = vi.fn();
    const el = mount(onClose);
    const list = el.querySelector('[data-list]')!;
    const sheet = el.querySelector('.m-sheet') as HTMLElement;
    pull(list, 80, 80 + SHEET_DISMISS_DY + 40);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    pull(list, 80, 80 + SHEET_DRAG_SLOP + 20);
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe('');
  });

  it('a downward pull mid-list scrolls the list, while the handle still drags the sheet', () => {
    const onClose = vi.fn();
    const el = mount(onClose, 80);
    const list = el.querySelector('[data-list]')!;
    pull(list, 100, 100 + SHEET_DISMISS_DY + 80);
    expect(onClose).not.toHaveBeenCalled();
    expect((el.querySelector('.m-sheet') as HTMLElement).style.transform).toBe('');

    const grip = el.querySelector('.m-sheet-grip')!;
    pull(grip, 40, 40 + SHEET_DISMISS_DY + 20);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the TV shell and the centered TV dialog free of the phone grip', () => {
    const tv = readFileSync(resolve('src/app.tsx'), 'utf8');
    expect(tv).not.toContain('Sheet');
    expect(tv).not.toContain('m-sheet-grip');
    const dialog = readFileSync(resolve('mobile/src/ui/OldTvDialog.tsx'), 'utf8');
    expect(dialog).not.toContain('m-sheet-grip');
    expect(dialog).toContain('m-dialog');
    const confirm = readFileSync(resolve('mobile/src/ui/confirm.tsx'), 'utf8');
    expect(confirm).not.toContain('m-sheet-grip');
    expect(confirm).toContain('m-dialog');
  });

  it('mounts every phone bottom sheet through the shared Sheet', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.tsx')) files.push(p.split('\\').join('/'));
      }
    };
    walk('mobile/src');
    const hosts = files.filter((f) => readFileSync(f, 'utf8').includes('m-sheet-host')).sort();
    expect(hosts).toEqual(['mobile/src/ui/OldTvDialog.tsx', 'mobile/src/ui/Sheet.tsx', 'mobile/src/ui/confirm.tsx']);
    const sheet = readFileSync('mobile/src/ui/Sheet.tsx', 'utf8');
    expect(sheet).toContain('moveSheetDrag');
    expect(sheet).toContain('aria-label={t(\'common.close\')}');
    const users = files.filter((f) => /<Sheet[\s>]/.test(readFileSync(f, 'utf8'))).sort();
    expect(users).toEqual([
      'mobile/src/screens/Add.tsx',
      'mobile/src/screens/InstallAssistant.tsx',
      'mobile/src/screens/Library.tsx',
      'mobile/src/screens/Monitor.tsx',
      'mobile/src/screens/Remote.tsx',
      'mobile/src/screens/ServerSettings.tsx',
      'mobile/src/screens/Settings.tsx',
      'mobile/src/screens/SourcesIndexers.tsx',
      'mobile/src/screens/Torrent.tsx',
      'mobile/src/screens/catalog/DiscoverSheets.tsx',
      'mobile/src/screens/catalog/PosterSheet.tsx',
      'mobile/src/screens/catalog/WantSheet.tsx',
      'mobile/src/ui/BetterSheet.tsx',
      'mobile/src/ui/BoxCodeSheet.tsx',
      'mobile/src/ui/CertChangedSheet.tsx',
      'mobile/src/ui/CodeSheet.tsx',
      'mobile/src/ui/DonateSheet.tsx',
      'mobile/src/ui/FiltersSheet.tsx',
      'mobile/src/ui/LocalUpdateSheet.tsx',
      'mobile/src/ui/ReleasesSheet.tsx',
      'mobile/src/ui/RenameSheet.tsx',
      'mobile/src/ui/ReplaceSheet.tsx',
      'mobile/src/ui/ResultCard.tsx',
      'mobile/src/ui/ResumeSheet.tsx',
      'mobile/src/ui/SeriesMenu.tsx',
      'mobile/src/ui/SubSheet.tsx',
      'mobile/src/ui/SubsLimitSheet.tsx',
      'mobile/src/ui/TorrentMenu.tsx',
      'mobile/src/ui/TorrentRenameSheet.tsx',
      'mobile/src/ui/TouchpadSheet.tsx',
      'mobile/src/ui/TrackerLogin.tsx',
      'mobile/src/ui/TracksSheet.tsx',
      'mobile/src/ui/UpdateSheet.tsx',
      'mobile/src/ui/WhatsNewSheet.tsx',
    ]);
  });
});

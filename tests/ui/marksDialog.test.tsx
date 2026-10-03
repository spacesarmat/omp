import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { MarksDialog } from '../../src/ui/MarksDialog';
import { dispatchKey } from '../../src/ui/keys';
import { saveSkip, loadSkip, type JournalClient } from '../../src/store/journal';
import { torrents } from '../../src/store/library';
import { logEntries, clearLog } from '../../src/lib/log';
import type { Torrent } from '../../src/api/types';
import type { TvMarks } from '../../src/lib/skipMarks';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

let host: HTMLElement;
const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
const values = () => Array.prototype.map.call(host.querySelectorAll('.marks-value'), (e: Element) => e.textContent) as string[];
const key = (a: 'left' | 'right' | 'back', repeat = false) => {
  let r: unknown;
  act(() => { r = dispatchKey(a, { repeat } as KeyboardEvent); });
  return r;
};
const focusRow = async (k: string) => {
  act(() => setFocus(k));
  await flush();
  expect(getCurrentFocusKey()).toBe(k);
};

function mount(prefs: TvMarks, onSave: (m: TvMarks) => Promise<unknown> = () => Promise.resolve(), onClose: () => void = () => undefined) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h(MarksDialog, { subtitle: 'Starbound Frontier · для всех серий · главы файла важнее', prefs, onSave, onClose }), host));
}
const button = (label: string) => Array.prototype.filter.call(host.querySelectorAll('.button'), (b: Element) => (b.textContent || '').indexOf(label) >= 0)[0] as HTMLElement;

beforeEach(() => clearLog());
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

describe('TV marks dialog', () => {
  it('shows the three rows with the saved marks', async () => {
    mount({ mi: [45, 135], mc: 90 });
    expect(Array.prototype.map.call(host.querySelectorAll('.marks-label'), (e: Element) => e.textContent)).toEqual(['Заставка с', 'Заставка до', 'Титры: последние']);
    expect(values()).toEqual(['0:45', '2:15', '1:30']);
    expect(host.querySelector('.dialog-title')!.textContent).toBe('Заставка и титры');
  });

  it('shows a dash for marks that are not set', async () => {
    mount({ mi: null, mc: null });
    expect(values()).toEqual(['—', '—', '—']);
  });

  it('steps the focused row by 5 s with left/right and takes the key', async () => {
    mount({ mi: [45, 135], mc: 90 });
    await focusRow('marks-from');
    expect(key('right')).toBe(true);
    expect(values()[0]).toBe('0:50');
    key('left');
    key('left');
    expect(values()[0]).toBe('0:40');
    await focusRow('marks-last');
    key('right');
    expect(values()[2]).toBe('1:35');
  });

  it('a held key steps by 30 s', async () => {
    mount({ mi: [45, 135], mc: 90 });
    await focusRow('marks-to');
    key('right', true);
    expect(values()[1]).toBe('2:45');
    key('left', true);
    key('left', true);
    expect(values()[1]).toBe('1:45');
  });

  it('the clickable arrows step too', async () => {
    mount({ mi: [45, 135], mc: 90 });
    const steps = host.querySelectorAll('.marks-step');
    act(() => (steps[1] as HTMLElement).click());
    expect(values()[0]).toBe('0:50');
    act(() => (steps[0] as HTMLElement).click());
    expect(values()[0]).toBe('0:45');
  });

  it('keeps the marks inside the bounds: start before end, never below 0', async () => {
    mount({ mi: [3, 10], mc: 3 });
    await focusRow('marks-from');
    key('left');
    expect(values()[0]).toBe('0:00');
    key('right', true);
    expect(values()[0]).toBe('0:09');
    await focusRow('marks-to');
    key('left', true);
    expect(values()[1]).toBe('0:10');
    await focusRow('marks-last');
    key('left', true);
    expect(values()[2]).toBe('0:01');
  });

  it('keys other than left/right and Back are left to the spatial navigation', async () => {
    mount({ mi: null, mc: null });
    expect(dispatchKey('down', {} as KeyboardEvent)).toBe('spatial');
    expect(dispatchKey('red', {} as KeyboardEvent)).toBe('spatial');
  });

  it('Save writes the marks and closes', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    mount({ mi: [45, 135], mc: 90 }, onSave, onClose);
    await focusRow('marks-last');
    key('right');
    act(() => button('Сохранить').click());
    await flush();
    expect(onSave).toHaveBeenCalledWith({ mi: [45, 135], mc: 95 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Reset removes both marks and closes', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    mount({ mi: [45, 135], mc: 90 }, onSave, onClose);
    act(() => button('Сбросить').click());
    await flush();
    expect(onSave).toHaveBeenCalledWith({ mi: null, mc: null });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Back closes without saving', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    mount({ mi: [45, 135], mc: 90 }, onSave, onClose);
    await focusRow('marks-from');
    key('right');
    expect(key('back')).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('stays open and shows the error when saving fails, and logs it without titles', async () => {
    const onClose = vi.fn();
    mount({ mi: [45, 135], mc: null }, () => Promise.reject(new Error('сервер недоступен')), onClose);
    act(() => button('Сохранить').click());
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('.marks-error')!.textContent).toContain('сервер недоступен');
    const entries = logEntries();
    expect(entries[entries.length - 1].x).toBe('Не удалось сохранить отметки пропуска');
    expect(entries[entries.length - 1].a).toBe('tv');
    expect(button('Сохранить').textContent).toBe('Сохранить');
  });
});

describe('TV marks dialog -> TorrServer journal', () => {
  const H = 'e'.repeat(40);
  it('writes omp.s and keeps the history and the unknown keys', async () => {
    const stored: { data: string } = {
      data: JSON.stringify({ TorrServer: { Files: [] }, other: { x: 1 }, omp: { v: 1, h: [{ f: 1, t: 10, d: 100, at: 5, src: 'tv' }], w: false, future: [1, 2], s: { i: true, c: false } } }),
    };
    const t = { hash: H, title: 'Starbound', data: stored.data } as Torrent;
    torrents.value = [t];
    const client: JournalClient = {
      list: () => Promise.resolve([{ ...t, data: stored.data }]),
      setData: (_t, data) => {
        stored.data = data;
        return Promise.resolve();
      },
    };
    mount({ mi: null, mc: null }, (m) => saveSkip(client, { hash: H }, { mi: m.mi, mc: m.mc }));
    await focusRow('marks-from');
    key('right', true);
    await focusRow('marks-last');
    key('right');
    act(() => button('Сохранить').click());
    await flush();
    const out = JSON.parse(stored.data);
    expect(out.other).toEqual({ x: 1 });
    expect(out.omp.future).toEqual([1, 2]);
    expect(out.omp.w).toBe(false);
    expect(out.omp.h).toHaveLength(1);
    expect(out.omp.s).toEqual({ i: true, c: false, mi: [30, 90], mc: 95 });
    expect(await loadSkip(client, H)).toEqual({ i: true, c: false, mi: [30, 90], mc: 95 });
  });
});

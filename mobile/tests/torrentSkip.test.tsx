import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../src/store/journal', async (orig) => ({
  ...(await orig<typeof import('../../src/store/journal')>()),
  loadSkip: vi.fn(),
  saveSkip: vi.fn(),
}));

import { Torrent } from '../src/screens/Torrent';
import { resetTo, navigate } from '../src/nav';
import { toast } from '../src/ui/toast';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { TorrServerClient } from '../../src/api/torrserver';
import { loadSkip, saveSkip } from '../../src/store/journal';
import type { FfprobeResult, Torrent as T } from '../../src/api/types';

const tor: T = {
  hash: 'abc',
  title: 'Starbound Frontier S02 1080p WEB-DL',
  stat: 3,
  file_stats: [1, 2].map((i) => ({ id: i, path: 'Show.S02E0' + i + '.mkv', length: 1e9 })),
};
const loadMock = loadSkip as unknown as ReturnType<typeof vi.fn>;
const saveMock = saveSkip as unknown as ReturnType<typeof vi.fn>;
let el: HTMLElement;
let probeResult: FfprobeResult | null;

const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
const byText = (text: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').includes(text));
const sw = (label: string) => el.querySelector('[role=switch][aria-label="' + label + '"]') as HTMLElement;
const click = (n: Element | undefined | null) => {
  if (!n) throw new Error('missing element');
  act(() => { (n as HTMLElement).click(); });
};
function type(id: string, value: string) {
  const input = el.querySelector('#' + id) as HTMLInputElement;
  input.value = value;
  act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });
}

async function mount(prefs: any = { i: false, c: false }) {
  loadMock.mockImplementation(() => Promise.resolve(prefs));
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => { render(<Torrent hash="abc" />, el); });
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [tor];
  serverViewed.value = [];
  toast.value = '';
  probeResult = { streams: [] };
  loadMock.mockReset();
  saveMock.mockReset();
  resetTo({ name: 'library' });
  navigate({ name: 'torrent', hash: 'abc' });
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'probe').mockImplementation(() => Promise.resolve(probeResult));
});
afterEach(() => {
  act(() => render(null, el));
  vi.restoreAllMocks();
});

describe('phone torrent card · Пропуск', () => {
  it('shows the block with the saved prefs and the status', async () => {
    await mount({ i: true, c: false });
    expect(el.querySelector('.m-skip-title')!.textContent).toBe('Пропуск');
    expect(sw('Пропускать заставку').getAttribute('aria-checked')).toBe('true');
    expect(sw('Пропускать титры').getAttribute('aria-checked')).toBe('false');
    expect(el.textContent).toContain('сразу следующая серия');
    expect(byText('Заставка и титры')!.textContent).toContain('не заданы');
  });

  it('a switch saves at once', async () => {
    saveMock.mockResolvedValue({ i: true, c: false });
    await mount();
    click(sw('Пропускать заставку'));
    expect(saveMock.mock.calls[0][2]).toEqual({ i: true });
    expect(sw('Пропускать заставку').getAttribute('aria-checked')).toBe('true');
    await flush();
    expect(sw('Пропускать заставку').getAttribute('aria-checked')).toBe('true');
  });

  it('a failed write puts the switch back and toasts the error', async () => {
    saveMock.mockRejectedValue(new Error('сервер недоступен'));
    await mount();
    click(sw('Пропускать титры'));
    await flush();
    expect(sw('Пропускать титры').getAttribute('aria-checked')).toBe('false');
    expect(toast.value).toContain('сервер недоступен');
  });

  it('status: chapters of the first file', async () => {
    probeResult = { streams: [], chapters: [{ start_time: '60', end_time: '150', tags: { title: 'Intro' } }] };
    await mount({ i: false, c: false, mi: [45, 135] });
    expect(byText('Заставка и титры')!.textContent).toContain('по главам файла');
    expect(TorrServerClient.prototype.probe).toHaveBeenCalledWith('abc', 1);
  });

  it('status: manual marks when the file has no chapters (or ffprobe is missing)', async () => {
    probeResult = null;
    await mount({ i: false, c: false, mi: [45, 135], mc: 90 });
    expect(byText('Заставка и титры')!.textContent).toContain('в файле нет глав · заставка 0:45–2:15 · титры: последние 1:30');
  });

  it('the sheet is filled from the marks and saves parsed values', async () => {
    saveMock.mockResolvedValue({ i: false, c: false, mi: [45, 135], mc: 90 });
    await mount({ i: false, c: false, mi: [30, 60], mc: 120 });
    click(byText('Заставка и титры'));
    expect((el.querySelector('#m-mark-from') as HTMLInputElement).value).toBe('0:30');
    expect((el.querySelector('#m-mark-last') as HTMLInputElement).value).toBe('2:00');
    expect(el.querySelector('[role=dialog]')!.textContent).toContain('Удобнее отметить прямо в плеере: меню → «Отметить начало заставки».');
    type('m-mark-from', '0:45');
    type('m-mark-to', '2:15');
    type('m-mark-last', '1:30');
    click(byText('Сохранить'));
    await flush();
    expect(saveMock.mock.calls[0][2]).toEqual({ mi: [45, 135], mc: 90 });
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('accepts h:mm:ss and keeps an empty credits field as no mark', async () => {
    saveMock.mockResolvedValue({ i: false, c: false });
    await mount();
    click(byText('Заставка и титры'));
    type('m-mark-from', '1:00');
    type('m-mark-to', '1:01:05');
    click(byText('Сохранить'));
    await flush();
    expect(saveMock.mock.calls[0][2]).toEqual({ mi: [60, 3665], mc: null });
  });

  it('rejects bad input without writing', async () => {
    await mount();
    click(byText('Заставка и титры'));
    type('m-mark-from', '2:00');
    type('m-mark-to', '1:00');
    click(byText('Сохранить'));
    expect(el.querySelector('[role=alert]')!.textContent).toContain('позже начала');
    type('m-mark-to', 'abc');
    click(byText('Сохранить'));
    expect(el.querySelector('[role=alert]')!.textContent).toContain('мин:сек');
    type('m-mark-to', '3:00');
    type('m-mark-last', '1:99');
    click(byText('Сохранить'));
    expect(el.querySelector('[role=alert]')!.textContent).toContain('мин:сек');
    expect(saveMock).not.toHaveBeenCalled();
    expect(el.querySelector('[role=dialog]')).toBeTruthy();
  });

  it('«Сбросить» removes both marks', async () => {
    saveMock.mockResolvedValue({ i: false, c: false });
    await mount({ i: false, c: false, mi: [30, 60], mc: 120 });
    click(byText('Заставка и титры'));
    click(byText('Сбросить'));
    await flush();
    expect(saveMock.mock.calls[0][2]).toEqual({ mi: null, mc: null });
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('a failed save keeps the sheet open and shows the error', async () => {
    saveMock.mockRejectedValue(new Error('нет связи'));
    await mount();
    click(byText('Заставка и титры'));
    type('m-mark-last', '1:30');
    click(byText('Сохранить'));
    await flush();
    expect(el.querySelector('[role=dialog]')).toBeTruthy();
    expect(el.querySelector('[role=alert]')!.textContent).toContain('нет связи');
    expect(toast.value).toContain('нет связи');
  });
});

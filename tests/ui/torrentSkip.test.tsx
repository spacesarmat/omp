import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/store/journal', async (orig) => ({
  ...(await orig<typeof import('../../src/store/journal')>()),
  loadSkip: vi.fn(),
  saveSkip: vi.fn(),
}));

import { TorrentScreen } from '../../src/screens/Torrent';
import { ToastHost, toast } from '../../src/ui/toast';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { TorrServerClient } from '../../src/api/torrserver';
import { loadSkip, saveSkip } from '../../src/store/journal';
import type { FfprobeResult, Torrent } from '../../src/api/types';

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const H = 'd'.repeat(40);
const tor: Torrent = {
  hash: H,
  title: 'Starbound Frontier S02 1080p',
  stat: 3,
  file_stats: [1, 2].map((i) => ({ id: i, path: 'Show.S02E0' + i + '.mkv', length: 1e9 })),
};
const loadMock = loadSkip as unknown as ReturnType<typeof vi.fn>;
const saveMock = saveSkip as unknown as ReturnType<typeof vi.fn>;
let host: HTMLElement;
let probeResult: FfprobeResult | null;

const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
const rows = () => Array.prototype.slice.call(host.querySelectorAll('.skip-row')) as HTMLElement[];
const row = (text: string) => rows().filter((r) => (r.textContent || '').indexOf(text) >= 0)[0];

async function mount(prefs = { i: false, c: false } as any) {
  loadMock.mockImplementation(() => Promise.resolve(prefs));
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(h('div', {}, h(TorrentScreen, { hash: H }), h(ToastHost, {})), host));
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [tor];
  probeResult = { streams: [] };
  loadMock.mockReset();
  saveMock.mockReset();
  vi.spyOn(TorrServerClient.prototype, 'get').mockResolvedValue(tor);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'probe').mockImplementation(() => Promise.resolve(probeResult));
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
});

describe('TV torrent card · Пропуск', () => {
  it('shows two switches and the status, reflecting the saved prefs', async () => {
    await mount({ i: true, c: false });
    expect(host.querySelector('.skip-title')!.textContent).toBe('Пропуск');
    const sw = host.querySelectorAll('[role=switch]');
    expect(sw[0].getAttribute('aria-checked')).toBe('true');
    expect(sw[1].getAttribute('aria-checked')).toBe('false');
    expect(row('Заставка и титры').textContent).toContain('не заданы');
  });

  it('saves a switch at once', async () => {
    saveMock.mockResolvedValue({ i: false, c: true });
    await mount();
    act(() => row('Пропускать титры — сразу следующая серия').click());
    expect(saveMock.mock.calls[0][2]).toEqual({ c: true });
    expect(row('Пропускать титры').querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('true');
    await flush();
    expect(row('Пропускать титры').querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('true');
  });

  it('puts the switch back and shows the error when the write fails', async () => {
    saveMock.mockRejectedValue(new Error('сервер недоступен'));
    await mount();
    act(() => row('Пропускать заставку автоматически').click());
    await flush();
    expect(row('Пропускать заставку').querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector('.toast-error')!.textContent).toContain('сервер недоступен');
  });

  it('status: by the chapters of the first file', async () => {
    probeResult = { streams: [], chapters: [{ start_time: '60', end_time: '150', tags: { title: 'Заставка' } }] };
    await mount({ i: false, c: false, mi: [45, 135] });
    expect(row('Заставка и титры').textContent).toContain('по главам файла');
    expect(TorrServerClient.prototype.probe).toHaveBeenCalledWith(H, 1);
  });

  it('status: manual marks without chapters, and without ffprobe', async () => {
    probeResult = null;
    await mount({ i: false, c: false, mi: [45, 135], mc: 90 });
    expect(row('Заставка и титры').textContent).toContain('в файле нет глав · заставка 0:45–2:15 · титры: последние 1:30');
  });
});

describe('TV torrent card · quick taps', () => {
  it('two quick taps on one switch end up off, from the latest state', async () => {
    saveMock.mockResolvedValue({ i: false, c: false });
    await mount();
    act(() => { row('Пропускать заставку').click(); row('Пропускать заставку').click(); });
    expect(saveMock.mock.calls.map((x) => x[2])).toEqual([{ i: true }, { i: false }]);
    await flush();
    expect(row('Пропускать заставку').querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('a failed first write does not undo a later tap on the other switch', async () => {
    saveMock.mockRejectedValueOnce(new Error('сбой')).mockResolvedValueOnce({ i: false, c: true });
    await mount();
    act(() => { row('Пропускать заставку').click(); row('Пропускать титры').click(); });
    await flush();
    expect(row('Пропускать заставку').querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('false');
    expect(row('Пропускать титры').querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('true');
  });
});

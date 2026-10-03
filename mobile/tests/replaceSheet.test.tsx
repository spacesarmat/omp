import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../src/monitor/replace', async (orig) => ({
  ...(await orig<typeof import('../../src/monitor/replace')>()),
  replaceWithResult: vi.fn(),
}));

import { ReplaceSheet } from '../src/ui/ReplaceSheet';
import { toast } from '../src/ui/toast';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrents } from '../../src/store/library';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth, setSourceOn } from '../../src/sources/store';
import { replaceWithResult } from '../../src/monitor/replace';
import { addFindings, findingsOf } from '../../src/monitor/subs';
import type { SourceResult } from '../../src/sources/types';
import type { Finding } from '../../src/monitor/types';

const OLD = 'b'.repeat(40);
const replaceMock = replaceWithResult as unknown as ReturnType<typeof vi.fn>;
let el: HTMLElement;
let close: Mock<() => void>;

function row(p: Partial<SourceResult>): SourceResult {
  return { Title: '', Categories: '', Size: '17,6 ГБ', CreateDate: '', Tracker: '', Link: '', Magnet: 'magnet:?xt=urn:btih:' + 'c'.repeat(40), Hash: 'c'.repeat(40), Peer: 0, Seed: 820, source: 'fake', ...p };
}

const best = row({ Title: 'Starbound Frontier / Сезон 2 / Серии 1-10 из 10 / 1080p' });
const other = row({ Title: 'Starbound Frontier / Сезон 2 / Серии 1-9 из 10 / 720p', Hash: 'd'.repeat(40), Magnet: 'magnet:?xt=urn:btih:' + 'd'.repeat(40), Seed: 40, Size: '9 ГБ' });

const finding: Finding = {
  subId: 'episodes',
  key: OLD + ':2:10',
  at: 5,
  result: best,
  episodes: { torrentHash: OLD, torrentTitle: 'Starbound Frontier / Сезон 2 / Серии 1-8 из 10 / 1080p', season: 2, haveTo: 8, from: 1, to: 10 },
};

const flush = () =>
  act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
const byText = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t);
const click = (n: Element | undefined | null) => {
  if (!n) throw new Error('missing element');
  act(() => (n as HTMLElement).click());
};

async function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  close = vi.fn();
  await act(async () => render(<ReplaceSheet finding={finding} onClose={close} />, el));
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  setSourceOn('ts-rutor', false);
  setSourceOn('ts-torznab', false);
  registerSource({ id: 'fake', name: 'rutor', kind: 'builtin', search: () => Promise.resolve([best, other]) });
  torrents.value = [{ hash: OLD, title: finding.episodes!.torrentTitle, category: 'tv', stat: 3, torrent_size: 14.1 * 1024 ** 3 } as any];
  addFindings([finding]);
  toast.value = '';
  replaceMock.mockReset();
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
});

afterEach(() => {
  act(() => render(null, el));
  unregisterSource('fake');
  vi.restoreAllMocks();
});

describe('ReplaceSheet', () => {
  it('shows the old and the new release and what is carried over', async () => {
    await mount();
    const t = el.textContent!;
    expect(t).toContain('Starbound Frontier · Сезон 2');
    expect(el.querySelectorAll('.m-rep-line')[0].textContent).toMatch(/^Серии 1–8 из 10 · 1080p · /);
    expect(el.querySelectorAll('.m-rep-line')[1].textContent).toBe('Серии 1–10 из 10 · 1080p · 17,6 ГБ');
    expect(t).toContain('Новая · rutor · 820 сидов');
    expect(t).toContain('История просмотров и места остановки переносятся');
    expect(t).toContain('Настройки «Пропуск» и категория переносятся');
    expect(t).toContain('Старая раздача удаляется с сервера');
    expect(t).toContain('ещё 1 вариант ›');
  });

  it('«Другая раздача» picks another candidate', async () => {
    await mount();
    click(Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').startsWith('Другая раздача')));
    click(Array.from(el.querySelectorAll('[role=radio]')).find((b) => (b.textContent || '').includes('720p')));
    expect(el.querySelectorAll('.m-rep-line')[1].textContent).toBe('Серии 1–9 из 10 · 720p · 9 ГБ');
    replaceMock.mockResolvedValue({ ok: true, hash: 'd'.repeat(40) });
    click(byText('Заменить'));
    await flush();
    expect(replaceMock.mock.calls[0][1]).toBe(OLD);
    expect(replaceMock.mock.calls[0][2]).toMatchObject(other);
  });

  it('«Заменить»: progress, then the toast; the card goes', async () => {
    let finish: (v: unknown) => void = () => {};
    replaceMock.mockImplementation(() => new Promise((r) => (finish = r)));
    await mount();
    click(byText('Заменить'));
    expect(el.textContent).toContain('Заменяю…');
    expect(byText('Заменить')!.disabled).toBe(true);
    await act(async () => finish({ ok: true, hash: 'c'.repeat(40) }));
    await flush();
    expect(replaceMock.mock.calls[0][2]).toBe(best);
    expect(toast.value).toBe('Заменено: Starbound Frontier');
    expect(findingsOf('episodes')).toEqual([]);
    expect(close).toHaveBeenCalled();
  });

  it('a failed replace shows the error and keeps the card', async () => {
    replaceMock.mockResolvedValue({ ok: false, error: 'Новая раздача не загрузилась — старая оставлена.' });
    await mount();
    click(byText('Заменить'));
    await flush();
    expect(el.querySelector('[role=alert]')!.textContent).toBe('Новая раздача не загрузилась — старая оставлена.');
    expect(findingsOf('episodes')).toHaveLength(1);
    expect(close).not.toHaveBeenCalled();
    expect(byText('Заменить')!.disabled).toBe(false);
  });

  it('the old torrent is gone from the server: says so, nothing is replaced', async () => {
    torrents.value = [];
    await mount();
    click(byText('Заменить'));
    await flush();
    expect(el.querySelector('[role=alert]')!.textContent).toBe('Этой раздачи уже нет на сервере');
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

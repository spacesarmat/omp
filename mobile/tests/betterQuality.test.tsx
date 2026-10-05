import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../src/store/journal', async (orig) => ({
  ...(await orig<typeof import('../../src/store/journal')>()),
  loadSkip: vi.fn(async () => ({ i: false, c: false })),
  loadWatch: vi.fn(async () => true),
  loadQualityWatch: vi.fn(),
  saveQualityWatch: vi.fn(),
}));
vi.mock('../../src/monitor/replace', async (orig) => ({
  ...(await orig<typeof import('../../src/monitor/replace')>()),
  replaceWithResult: vi.fn(),
}));

import { applyLanguageSetting } from '../../src/i18n';
import { News, resetNews } from '../src/screens/News';
import { Torrent } from '../src/screens/Torrent';
import { ReplaceSheet } from '../src/ui/ReplaceSheet';
import { navigate, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { fakeMonitor, type FakeMonitor } from './fakeMonitor';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrents } from '../../src/store/library';
import { reloadProgress, serverViewed } from '../../src/store/progress';
import { loadQualityWatch, saveQualityWatch } from '../../src/store/journal';
import { replaceWithResult } from '../../src/monitor/replace';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { reloadSourcePrefs, resetHealth, setSourceOn } from '../../src/sources/store';
import { addFindings, findingsOf, unseenCount } from '../../src/monitor/subs';
import { saveMonitorSettings } from '../../src/monitor/settings';
import { BETTER_ID, type Finding } from '../../src/monitor/types';
import type { SourceResult } from '../../src/sources/types';
import type { Torrent as T } from '../../src/api/types';

const OLD = 'b'.repeat(40);
const FILM = 'Северный ветер (2026) WEB-DL 1080p';
let el: HTMLElement;
let mon: FakeMonitor;
const loadQ = loadQualityWatch as unknown as ReturnType<typeof vi.fn>;
const saveQ = saveQualityWatch as unknown as ReturnType<typeof vi.fn>;
const replaceMock = replaceWithResult as unknown as ReturnType<typeof vi.fn>;

function row(p: Partial<SourceResult>): SourceResult {
  return { Title: 'Северный ветер (2026) 2160p WEB-DL', Categories: '', Size: '18,2 ГБ', CreateDate: '', Tracker: '', Link: '', Magnet: 'magnet:?xt=urn:btih:' + 'c'.repeat(40), Hash: 'c'.repeat(40), Peer: 0, Seed: 940, source: 'fake', ...p };
}
const bd = row({ Title: 'Северный ветер (2026) BDRip 1080p', Hash: 'd'.repeat(40), Magnet: 'magnet:?xt=urn:btih:' + 'd'.repeat(40), Seed: 40 });

function betterFinding(p: Partial<Finding> = {}): Finding {
  return {
    subId: BETTER_ID,
    key: OLD + ':32',
    at: 1000,
    result: row({}),
    better: { torrentHash: OLD, torrentTitle: FILM, have: '1080p WEB-DL', got: '4K WEB-DL' },
    ...p,
  };
}

const film: T = { hash: OLD, title: FILM, category: 'movie', stat: 3, torrent_size: 9 * 1024 ** 3, file_stats: [{ id: 1, path: 'North.Wind.2026.mkv', length: 9e9 }] } as T;

const flush = () =>
  act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
const byText = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t);
const click = (n: Element | undefined | null) => {
  if (!n) throw new Error('missing element');
  act(() => (n as HTMLElement).click());
};

async function mount(node: ComponentChild) {
  if (el) act(() => render(null, el));
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => render(node, el));
  await flush();
}

async function mountTorrent(t: T) {
  torrents.value = [t];
  resetTo({ name: 'library' });
  navigate({ name: 'torrent', hash: t.hash });
  await mount(<Torrent hash={t.hash} />);
}

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  resetNews();
  reloadProgress();
  serverViewed.value = [];
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  setSourceOn('ts-rutor', false);
  setSourceOn('ts-torznab', false);
  registerSource({ id: 'fake', name: 'rutor', kind: 'builtin', search: () => Promise.resolve([row({}), bd]) });
  torrents.value = [film];
  toast.value = '';
  loadQ.mockReset().mockResolvedValue(true);
  saveQ.mockReset();
  replaceMock.mockReset();
  resetTo({ name: 'news' });
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'tmdbSettings').mockResolvedValue(null);
  vi.spyOn(TorrServerClient.prototype, 'viewedList').mockResolvedValue([]);
  vi.spyOn(TorrServerClient.prototype, 'probe').mockResolvedValue({ streams: [] });
  mon = fakeMonitor();
});

afterEach(() => {
  act(() => render(null, el));
  unregisterSource('fake');
  mon.restore();
  vi.restoreAllMocks();
  applyLanguageSetting('ru');
});

describe('«Новое» · Лучшее качество', () => {
  it('the film card says what came out and what you have; it counts as looked at', async () => {
    addFindings([betterFinding()]);
    await mount(<News seg="subs" />);
    const card = el.querySelector('[data-better]')!;
    expect(el.textContent).toContain('Лучшее качество');
    expect(card.textContent).toContain('Северный ветер');
    expect(card.textContent).toContain('4K WEB-DL · у вас 1080p WEB-DL');
    expect(card.textContent).toContain('Северный ветер (2026) 2160p WEB-DL');
    expect(unseenCount(BETTER_ID)).toBe(0);
    expect(el.textContent).toContain('Фильмы из каталога проверяются раз в сутки');
  });

  it('«Скрыть» drops the card', async () => {
    addFindings([betterFinding()]);
    await mount(<News seg="subs" />);
    click(byText('Скрыть'));
    await flush();
    expect(findingsOf(BETTER_ID)).toEqual([]);
    expect(el.querySelector('[data-better]')).toBeNull();
  });

  it('«Заменить…» opens the replace sheet for the film', async () => {
    addFindings([betterFinding()]);
    await mount(<News seg="subs" />);
    const card = el.querySelector('[data-better]')!;
    click(Array.from(card.querySelectorAll('button')).find((b) => b.textContent === 'Заменить…'));
    await flush();
    expect(el.querySelector('[role=dialog][aria-label="Заменить раздачу"]')).toBeTruthy();
  });

  it('switched off in the settings: says so', async () => {
    saveMonitorSettings({ better: false });
    await mount(<News seg="subs" />);
    expect(el.textContent).toContain('Слежение за качеством фильмов выключено в настройках мониторинга.');
  });
});

describe('ReplaceSheet for a film', () => {
  it('shows the film without a season, offers the other better releases and replaces', async () => {
    const f = betterFinding();
    addFindings([f]);
    const close = vi.fn();
    replaceMock.mockResolvedValue({ ok: true, hash: 'c'.repeat(40) });
    await mount(<ReplaceSheet finding={f} onClose={close} />);
    expect(el.textContent).toContain('Северный ветер');
    expect(el.textContent).not.toContain('Сезон');
    expect(el.textContent).toContain('ещё 1 вариант ›');
    click(byText('Заменить'));
    await flush();
    expect(replaceMock.mock.calls[0][1]).toBe(OLD);
    expect(replaceMock.mock.calls[0][2].Title).toBe('Северный ветер (2026) 2160p WEB-DL');
    expect(findingsOf(BETTER_ID)).toEqual([]);
    expect(close).toHaveBeenCalled();
  });
});

describe('film card · «Следить за качеством»', () => {
  const sw = () => el.querySelector('[role=switch][aria-label="Следить за качеством"]') as HTMLElement | null;

  it('a film shows the switch with the saved value; a series does not', async () => {
    loadQ.mockResolvedValue(false);
    await mountTorrent(film);
    expect(loadQ.mock.calls[0][1]).toBe(OLD);
    expect(sw()!.getAttribute('aria-checked')).toBe('false');
    await mountTorrent({
      ...film,
      title: 'Starbound Frontier S02 1080p WEB-DL',
      category: 'tv',
      file_stats: [1, 2].map((i) => ({ id: i, path: 'Show.S02E0' + i + '.mkv', length: 1e9 })),
    });
    expect(sw()).toBeNull();
  });

  it('switching off saves omp.q and drops the film\'s better-quality card', async () => {
    addFindings([betterFinding()]);
    saveQ.mockResolvedValue(false);
    await mountTorrent(film);
    click(sw());
    expect(sw()!.getAttribute('aria-checked')).toBe('false');
    expect(saveQ.mock.calls[0][2]).toBe(false);
    await flush();
    expect(findingsOf(BETTER_ID)).toEqual([]);
  });

  it('a failed write puts the switch back', async () => {
    saveQ.mockRejectedValue(new Error('Сервер недоступен'));
    await mountTorrent(film);
    click(sw());
    await flush();
    expect(sw()!.getAttribute('aria-checked')).toBe('true');
    expect(toast.value).toBe('Сервер недоступен');
  });
});

describe('«Лучшее качество» in English', () => {
  beforeEach(() => applyLanguageSetting('en'));

  it('the News section, its buttons and the film switch have no Russian', async () => {
    const EN = 'North Wind (2026) WEB-DL 1080p';
    addFindings([
      betterFinding({
        result: row({ Title: 'North Wind (2026) 2160p WEB-DL', Size: '18.2 GB' }),
        better: { torrentHash: OLD, torrentTitle: EN, have: '1080p WEB-DL', got: '4K WEB-DL' },
      }),
    ]);
    await mount(<News seg="subs" />);
    const card = el.querySelector('[data-better]')!;
    expect(el.textContent).toContain('Better quality');
    expect(card.textContent).toContain('4K WEB-DL · you have 1080p WEB-DL');
    expect(byText('Hide')).toBeTruthy();
    expect(byText('Replace…')).toBeTruthy();
    expect(card.textContent).not.toMatch(/[А-Яа-яЁё]/);
    expect(el.textContent).toContain('Catalog films are checked once a day');
    await mountTorrent({ ...film, title: EN });
    expect(el.querySelector('[role=switch][aria-label="Watch the quality"]')).toBeTruthy();
    expect(el.textContent).toContain('Monitoring');
  });
});

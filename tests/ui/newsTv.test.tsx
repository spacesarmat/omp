import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, getCurrentFocusKey, setFocus } from '@noriginmedia/norigin-spatial-navigation';

vi.mock('../../src/monitor/replaceTv', async (orig) => {
  const actual = await orig<typeof import('../../src/monitor/replaceTv')>();
  return { ...actual, replaceWithLink: vi.fn() };
});

import { LibraryScreen } from '../../src/screens/Library';
import { newsSeg, resetNewsCache, newsError, kindLine } from '../../src/screens/library/NewsTv';
import { DialogHost } from '../../src/ui/dialog';
import { ToastHost } from '../../src/ui/toast';
import { servers, activeServerId, addServer, setActiveServer } from '../../src/store/servers';
import { torrents, resetLibrary, libraryTab } from '../../src/store/library';
import { currentRoute, routeStack } from '../../src/ui/nav';
import { dispatchKey } from '../../src/ui/keys';
import { setRpcTransport, phoneStatus, PhoneRpcError } from '../../src/phone/rpc';
import { savePhoneLink, forgetPhoneLink } from '../../src/phone/phoneStore';
import { newsUnseen } from '../../src/phone/monitor';
import { replaceWithLink } from '../../src/monitor/replaceTv';
import { mockFetch } from '../helpers/fetchMock';
import type { RpcFinding, RpcResult } from '../../src/phone/rpcTypes';

const PH = { url: 'http://192.168.1.20:8097', token: 'f'.repeat(32), name: 'Samsung SM-G998B' };
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const ADDED = 'c'.repeat(40);

const fixture = [{ hash: OLD, title: 'Дюна: Часть вторая / Dune: Part Two (2024) WEB-DL 1080p', category: 'movie', timestamp: 1 }];

const result = (key: string, title: string, over: Partial<RpcResult> = {}): RpcResult => ({
  key: key,
  Title: title,
  Size: '8.2 GB',
  Seed: 40,
  Peer: 2,
  Tracker: 'rutracker',
  CreateDate: '',
  Categories: 'Сериалы',
  Magnet: '',
  Hash: '',
  source: 'rutracker',
  ...over,
});

const FINDINGS: RpcFinding[] = [
  {
    subId: 'episodes',
    key: 'h1:2:5',
    kind: 'episodes',
    at: 300,
    seen: false,
    title: 'Основание / Foundation',
    result: result('h1:2:5', 'Основание / Foundation / Сезон: 2 / Серии: 1-5 из 10 (2023) WEB-DL 1080p'),
    episodes: { torrentHash: 'd'.repeat(40), season: 2, to: 5 },
  },
  {
    subId: 's1',
    key: 'k7',
    kind: 'sub',
    at: 100,
    seen: true,
    title: 'Дюна',
    result: result('k7', 'Дюна: Пророчество / Dune: Prophecy (2024) WEBRip 720p', { Categories: 'Сериалы' }),
  },
  {
    subId: 'better',
    key: OLD + ':3',
    kind: 'better',
    at: 200,
    seen: false,
    title: 'Дюна: Часть вторая',
    result: result(OLD + ':3', 'Дюна: Часть вторая / Dune: Part Two (2024) UHD BDRemux 2160p HDR', { Categories: 'Фильмы' }),
    better: { torrentHash: OLD, have: '1080p', got: '4K' },
  },
];

type Reply = unknown;
let script: { [method: string]: Reply[] };
let calls: Array<{ method: string; params: any }>;

function useScript(s: { [method: string]: Reply[] }) {
  script = s;
  calls = [];
  setRpcTransport((_url, body) => {
    const req = JSON.parse(body);
    calls.push(req);
    const list = script[req.method] || [];
    const next = list.length > 1 ? list.shift() : list[0];
    if (next instanceof Error) return Promise.reject(next);
    if (next === undefined) return Promise.reject(new Error('network'));
    if (typeof next === 'string') return Promise.resolve(next);
    return Promise.resolve(JSON.stringify({ ok: true, result: next }));
  });
}

let adds: any[];

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  localStorage.clear();
  servers.value = [];
  activeServerId.value = null;
  document.body.innerHTML = '';
  adds = [];
  mockFetch((url, init) => {
    let body: any = {};
    try {
      body = JSON.parse(init.body || '{}');
    } catch (e) {
      body = {};
    }
    if (url.indexOf('/torrents') >= 0 && body.action === 'add') {
      adds.push(body);
      return { body: JSON.stringify({ hash: ADDED, title: body.title, category: body.category }) };
    }
    return { body: url.indexOf('/torrents') >= 0 ? JSON.stringify(fixture) : '[]' };
  });
  setActiveServer(addServer({ url: '10.0.0.2' }).id);
  resetLibrary();
  resetNewsCache();
  newsSeg.value = 'feed';
  newsUnseen.value = 0;
  torrents.value = fixture as any;
  routeStack.value = [{ name: 'library' }];
  libraryTab.value = 'news';
  savePhoneLink(PH);
  vi.mocked(replaceWithLink).mockReset();
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  while (hosts.length) {
    const host = hosts.pop()!;
    act(() => { render(null, host); });
  }
  setRpcTransport(null);
  forgetPhoneLink();
  phoneStatus.value = 'unknown';
});

const flush = async () => {
  for (let i = 0; i < 30; i++) await act(() => Promise.resolve());
};

async function mount() {
  const host = document.createElement('div');
  hosts.push(host);
  document.body.appendChild(host);
  act(() => { render(h('div', {}, h(LibraryScreen, {}), h(DialogHost, {}), h(ToastHost, {})), host); });
  await flush();
  return host;
}

const text = (el: Element | null) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
const rowOf = (host: Element, subId: string, key: string) => host.querySelector('[data-fk="news-' + subId + '-' + key + '"]') as HTMLElement;
const click = async (el: Element) => {
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};
const option = (label: string) =>
  (Array.prototype.slice.call(document.querySelectorAll('.dialog-option, .button')) as HTMLElement[]).filter((b) => text(b) === label)[0];

describe('TV «Новое» tab', () => {
  it('sits right after «История», with the unseen count', async () => {
    useScript({ feed: [{ findings: FINDINGS, lastRun: 1 }], findingsSeen: [{ ok: true }] });
    newsUnseen.value = 2;
    libraryTab.value = 'all';
    const host = await mount();
    const tabs = Array.prototype.map.call(host.querySelectorAll('.tab'), (e: Element) => e.getAttribute('data-fk'));
    expect(tabs.slice(0, 3)).toEqual(['tab-history', 'tab-news', 'tab-discover']);
    // the library asked the phone for the count
    expect(calls.map((c) => c.method)).toContain('feed');
    expect(text(host.querySelector('[data-fk="tab-news"] .tab-badge'))).toBe('2');
  });

  it('no phone: the card says where to connect it', async () => {
    forgetPhoneLink();
    useScript({});
    const host = await mount();
    expect(text(host.querySelector('.news-card'))).toContain('Новое и подписки ведёт OMP на телефоне');
    expect(text(host.querySelector('.news-card'))).toContain('Настройки → Телевизор');
    expect(calls.length).toBe(0);
    expect(text(host.querySelector('.hints'))).toBe('ОК — смотреть · Назад — к медиатеке');
  });

  it('a phone that does not answer: the note and «Повторить», which asks again', async () => {
    useScript({ feed: [new Error('timeout'), { findings: FINDINGS, lastRun: 1 }], findingsSeen: [{ ok: true }] });
    const host = await mount();
    expect(text(host.querySelector('.news-card'))).toContain('Телефон не отвечает — откройте OMP на телефоне');
    expect(text(host.querySelector('.news-phone'))).toContain('не отвечает');
    const retry = host.querySelector('[data-fk="news-retry"]') as HTMLElement;
    act(() => setFocus('news-retry'));
    await click(retry);
    expect(calls.filter((c) => c.method === 'feed').length).toBe(2);
    expect(host.querySelectorAll('.news-row').length).toBe(3);
    // the retry button went away with its rows: the focus went to the first row
    expect(getCurrentFocusKey()).toBe('news-episodes-h1:2:5');
  });

  it('shows the findings newest first with what was found, and the phone on line', async () => {
    useScript({ feed: [{ findings: FINDINGS, lastRun: 1 }], findingsSeen: [{ ok: true }] });
    const host = await mount();
    expect(text(host.querySelector('.news-phone'))).toBe('Телефон Samsung SM-G998B · на связи');
    expect(host.querySelector('.news-phone .src-note-ok')).not.toBeNull();
    const rows = Array.prototype.slice.call(host.querySelectorAll('.news-row')) as HTMLElement[];
    expect(rows.map((r) => text(r.querySelector('.news-kind')))).toEqual([
      'Новая серия S02E05',
      'Лучше качество: 1080p → 4K',
      'Подписка «Дюна»',
    ]);
    expect(text(rows[0].querySelector('.title'))).toBe('Основание');
    expect(rows[1].textContent).toContain('4K');
    expect(rows[0].querySelector('.news-dot')).not.toBeNull();
    expect(rows[2].querySelector('.news-dot')).toBeNull();
    expect(text(rows[2].querySelector('.search-size'))).toContain('↑40');
  });

  it('opening the tab marks the shown unseen findings seen on the phone', async () => {
    useScript({ feed: [{ findings: FINDINGS, lastRun: 1 }], findingsSeen: [{ ok: true }] });
    newsUnseen.value = 2;
    await mount();
    const seen = calls.filter((c) => c.method === 'findingsSeen').map((c) => c.params);
    expect(seen).toEqual([
      { subId: 'episodes', keys: ['h1:2:5'] },
      { subId: 'better', keys: [OLD + ':3'] },
    ]);
    expect(newsUnseen.value).toBe(0);
  });

  it('OK on a new episode asks the phone for the link, adds it and opens the torrent', async () => {
    useScript({
      feed: [{ findings: FINDINGS, lastRun: 1 }],
      findingsSeen: [{ ok: true }],
      findingLink: [{ link: 'magnet:?xt=urn:btih:' + NEW }],
    });
    const host = await mount();
    await click(rowOf(host, 'episodes', 'h1:2:5'));
    expect(calls.filter((c) => c.method === 'findingLink').map((c) => c.params)).toEqual([{ subId: 'episodes', key: 'h1:2:5' }]);
    expect(adds.length).toBe(1);
    expect(adds[0].link).toBe('magnet:?xt=urn:btih:' + NEW);
    expect(adds[0].title).toBe(FINDINGS[0].result.Title);
    expect(adds[0].category).toBe('tv');
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: ADDED });
  });

  it('a .torrent-only finding shows the phone message on its row', async () => {
    useScript({
      feed: [{ findings: FINDINGS, lastRun: 1 }],
      findingsSeen: [{ ok: true }],
      findingLink: ['{"ok":false,"error":{"code":"failed","message":"sources.tvFileOnly"}}'],
    });
    const host = await mount();
    await click(rowOf(host, 's1', 'k7'));
    expect(adds.length).toBe(0);
    expect(text(rowOf(host, 's1', 'k7').querySelector('.search-row-error'))).toBe('Эта раздача есть только файлом .torrent: добавьте её с телефона');
    expect(currentRoute.value.name).toBe('library');
  });

  it('OK on a better finding asks Replace / Add alongside / Cancel; «Заменить» replaces the old torrent', async () => {
    useScript({
      feed: [{ findings: FINDINGS, lastRun: 1 }],
      findingsSeen: [{ ok: true }],
      findingLink: [{ link: 'magnet:?xt=urn:btih:' + NEW }],
    });
    vi.mocked(replaceWithLink).mockResolvedValue({ ok: true, hash: NEW });
    const host = await mount();
    await click(rowOf(host, 'better', OLD + ':3'));
    expect(text(document.querySelector('.dialog-title'))).toContain('1080p → 4K');
    expect(option('Добавить рядом')).toBeTruthy();
    expect(option('Отмена')).toBeTruthy();
    await click(option('Заменить'));
    const args = vi.mocked(replaceWithLink).mock.calls[0];
    expect(args[1]).toBe(OLD);
    expect(args[2].Title).toBe(FINDINGS[2].result.Title);
    expect(args[3]).toBe('magnet:?xt=urn:btih:' + NEW);
    expect(adds.length).toBe(0);
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: NEW });
  });

  it('«Отмена» leaves everything as it was and the focus on the row', async () => {
    useScript({ feed: [{ findings: FINDINGS, lastRun: 1 }], findingsSeen: [{ ok: true }] });
    const host = await mount();
    const key = 'news-better-' + OLD + ':3';
    act(() => setFocus(key));
    await click(rowOf(host, 'better', OLD + ':3'));
    await click(option('Отмена'));
    expect(calls.filter((c) => c.method === 'findingLink').length).toBe(0);
    expect(vi.mocked(replaceWithLink)).not.toHaveBeenCalled();
    expect(getCurrentFocusKey()).toBe(key);
  });

  it('the «Подписки» segment selects on focus; Back goes to the library', async () => {
    useScript({ feed: [{ findings: FINDINGS, lastRun: 1 }], findingsSeen: [{ ok: true }] });
    const host = await mount();
    act(() => setFocus('news-seg-subs'));
    await flush();
    expect(newsSeg.value).toBe('subs');
    expect(host.querySelectorAll('.news-row').length).toBe(0);
    expect(getCurrentFocusKey()).toBe('news-seg-subs');
    act(() => { dispatchKey('back', new KeyboardEvent('keydown')); });
    await flush();
    expect(libraryTab.value).toBe('all');
    expect(getCurrentFocusKey()).toBe('tab-all');
  });
});

describe('news texts', () => {
  it('kind lines: an episode range, an unknown quality', () => {
    expect(kindLine({ ...FINDINGS[0], episodes: { torrentHash: 'x', season: 1, from: 9, to: 10 } })).toBe('Новые серии S01E09-E10');
    expect(kindLine({ ...FINDINGS[2], better: { torrentHash: OLD, have: '', got: '4K' } })).toBe('Лучше качество: качество не указано → 4K');
  });
  it('errors: a silent phone, the phone own message', () => {
    expect(newsError(new PhoneRpcError('timeout'))).toBe('Телефон не ответил — попробуйте ещё раз');
    expect(newsError(new PhoneRpcError('failed', 'This release comes only as a .torrent file: add it from the phone'))).toBe(
      'Эта раздача есть только файлом .torrent: добавьте её с телефона',
    );
    expect(newsError(new PhoneRpcError('failed', 'Сайт не ответил'))).toBe('Сайт не ответил');
  });
});

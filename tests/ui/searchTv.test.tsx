import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { init, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';

const askTextMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/ui/TextDialog', async (orig) => ({ ...(await orig<object>()), askText: askTextMock }));

import { AddScreen } from '../../src/screens/Add';
import { DialogHost } from '../../src/ui/dialog';
import { dispatchKey } from '../../src/ui/keys';
import { routeStack, currentRoute } from '../../src/ui/nav';
import { servers, addServer, setActiveServer, removeServer } from '../../src/store/servers';
import { torrents } from '../../src/store/library';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { setRpcTransport, phoneStatus } from '../../src/phone/rpc';
import { savePhoneLink, forgetPhoneLink } from '../../src/phone/phoneStore';
import { setPosterLookup } from '../../src/catalog/resultPosters';
import { mockFetch } from '../helpers/fetchMock';
import { lang } from '../../src/i18n';
import { resetSourceNames } from '../../src/sources/sourceNames';
import { setKindFilter } from '../../src/lib/releaseKind';

const PH = { url: 'http://192.168.1.20:8097', token: 'b'.repeat(32), name: 'Pixel' };
const HASH = 'c'.repeat(40);
const LIB_HASH = 'd'.repeat(40);
const MAG = 'magnet:?xt=urn:btih:' + 'e'.repeat(40);
const RAW_4K = 'Дюна / Dune (2021) 2160p HDR WEB-DL от DragonHeart | Дубляж';
const RAW_HD = 'Дюна / Dune (2021) 1080p BDRip';
const TS_ROW = { Title: 'Dune 2021 TS 720p', Categories: '', Size: '20 GB', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: 'magnet:?xt=urn:btih:' + HASH, Hash: HASH, Peer: 1, Seed: 9 };

function phoneRow(key: string, title: string, seed: number, extra: object = {}) {
  return { key, Title: title, Size: '10 GB', Seed: seed, Peer: 3, Tracker: 'RuTracker', CreateDate: '2024-03-01', date: '01.03.2024', Categories: '', Magnet: '', Hash: '', source: 'rutracker', ...extra };
}

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

const PHONE_DONE = {
  search: [{ handle: 'h1', sourceIds: ['rutracker', 'nnmclub'] }],
  searchPoll: [
    {
      rev: 2,
      done: true,
      pending: [],
      answered: ['rutracker', 'nnmclub'],
      failed: [],
      results: [phoneRow('1', RAW_HD, 300, { Hash: LIB_HASH.toUpperCase() }), phoneRow('2', RAW_4K, 50, { sources: ['rutor-ph'] })],
    },
  ],
};

let host: HTMLElement;
let fetchFn: ReturnType<typeof mockFetch>;

const step = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    render(
      h('div', {}, h(AddScreen, {}), h(DialogHost, {})),
      host,
    ),
  );
}

function typeQuery(v: string) {
  const q = host.querySelector('input') as HTMLInputElement;
  act(() => {
    q.value = v;
    q.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const button = (label: string) => Array.prototype.slice.call(host.querySelectorAll('.button')).filter((b: HTMLElement) => b.textContent === label)[0] as HTMLElement;
const rowTitles = () => Array.prototype.map.call(host.querySelectorAll('.search-raw'), (n: Element) => n.textContent) as string[];
const addCalls = () =>
  fetchFn.mock.calls.filter((c) => String(c[0]).slice(-9) === '/torrents' && String((c[1] || {}).body || '').indexOf('"add"') >= 0).map((c) => JSON.parse(c[1].body));

async function searchDune() {
  typeQuery('Dune');
  act(() => button('Искать').click());
  await step(2000);
}

beforeAll(() => {
  init({ debug: false, visualDebug: false });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  registerSource({ id: 'rutor-ph', name: 'Rutor', kind: 'builtin', search: () => Promise.resolve([]) });
  torrents.value = [{ hash: LIB_HASH, title: 'Dune', stat: 3 } as any];
  setPosterLookup(() => Promise.resolve(''));
  fetchFn = mockFetch((url, init) => {
    if (url.indexOf('/torrents') >= 0 && String(init.body || '').indexOf('"add"') >= 0) return { body: JSON.stringify({ hash: HASH, title: 'Dune', stat: 1 }) };
    if (url.indexOf('/search/') >= 0 && url.indexOf('/torznab/') < 0) return { body: JSON.stringify([TS_ROW]) };
    return { body: '[]' };
  });
  savePhoneLink(PH);
  routeStack.value = [{ name: 'library' }, { name: 'add' }];
  askTextMock.mockReset();
});

afterEach(() => {
  if (host) act(() => render(null, host));
  document.body.innerHTML = '';
  setRpcTransport(null);
  forgetPhoneLink();
  resetSourceNames();
  lang.value = 'ru';
  phoneStatus.value = 'unknown';
  unregisterSource('rutor-ph');
  torrents.value = [];
  setPosterLookup(null);
  routeStack.value = [{ name: 'connect' }];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TV search through the phone', () => {
  it('shows the phone progress line and rows with short titles, chips, raw titles and sources', async () => {
    useScript(PHONE_DONE);
    mount();
    await searchDune();
    expect(host.querySelector('.search-by')!.textContent).toBe('Ищет телефон Pixel · ');
    expect(host.querySelector('.search-status')!.textContent).toContain('Ищет телефон Pixel');
    expect(host.querySelector('.search-note')).toBeNull();
    // quality first: the 4K row above the 1080p one with more seeds
    expect(rowTitles()).toEqual([RAW_4K, RAW_HD]);
    const first = host.querySelectorAll('.search-result')[0];
    expect(first.querySelector('.title')!.textContent).toBe('Дюна');
    const chips = Array.prototype.map.call(first.querySelectorAll('.search-chip'), (n: Element) => n.textContent);
    expect(chips).toContain('4K');
    expect(chips).toContain('HDR');
    expect(first.querySelector('.search-chip.hot')!.textContent).toBe('4K');
    expect(first.textContent).toContain('ещё на Rutor');
    expect(first.textContent).toContain('10,0 ГБ · ↑50');
    expect(first.querySelector('.search-inlib')).toBeNull();
    // the other row is in the library (hash matched case-insensitively)
    expect(host.querySelectorAll('.search-result')[1].querySelector('.search-inlib')!.textContent).toBe('уже в медиатеке');
    expect(host.querySelector('.search-sort')!.textContent).toBe('Сортировка: качество');
  });

  it('OK on a row resolves its link through the phone, adds it and opens the torrent', async () => {
    useScript({ ...PHONE_DONE, resolve: [{ link: MAG }] });
    mount();
    await searchDune();
    act(() => (host.querySelector('.search-result') as HTMLElement).click());
    expect(host.textContent).toContain('Получаем ссылку…');
    await step(100);
    const res = calls.filter((c) => c.method === 'resolve');
    expect(res.map((c) => c.params)).toEqual([{ handle: 'h1', key: '2' }]);
    expect(addCalls().map((b) => b.link)).toEqual([MAG]);
    expect(currentRoute.value).toEqual({ name: 'torrent', hash: HASH });
    // the category is OMP's own pick: the automatic check may correct it later
    const auto = JSON.parse(localStorage.getItem('tsp.categoryAuto') || '{}');
    expect(Object.prototype.hasOwnProperty.call(auto, HASH.toLowerCase())).toBe(true);
    expect(auto[HASH.toLowerCase()]).toBe(addCalls()[0].category || '');
  });

  it('a release the phone cannot give as a link shows its message on the row', async () => {
    const msg = 'Эта раздача есть только файлом .torrent: добавьте её с телефона';
    useScript({ ...PHONE_DONE, resolve: [JSON.stringify({ ok: false, error: { code: 'failed', message: msg } })] });
    mount();
    await searchDune();
    act(() => (host.querySelector('.search-result') as HTMLElement).click());
    await step(100);
    expect(host.querySelector('.search-row-error')!.textContent).toBe(msg);
    expect(addCalls()).toEqual([]);
  });

  it('an expired search and a silent phone say what to do', async () => {
    useScript({ ...PHONE_DONE, resolve: [JSON.stringify({ ok: false, error: { code: 'expired' } })] });
    mount();
    await searchDune();
    act(() => (host.querySelector('.search-result') as HTMLElement).click());
    await step(100);
    expect(host.querySelector('.search-row-error')!.textContent).toBe('Результаты устарели — найдите ещё раз');
    script.resolve = [new Error('timeout')];
    act(() => (host.querySelector('.search-result') as HTMLElement).click());
    await step(100);
    expect(host.querySelector('.search-row-error')!.textContent).toBe('Телефон не ответил — попробуйте ещё раз');
  });

  it('a phone that does not answer: the yellow note and the TorrServer rows', async () => {
    useScript({ search: [new Error('timeout')] });
    mount();
    await searchDune();
    const note = host.querySelector('.search-note-warn')!;
    expect(note.textContent).toBe('Телефон не отвечает — откройте OMP на телефоне. Ищем через TorrServer (Rutor, Jackett)');
    expect(host.querySelector('.search-by')!.textContent).toBe('Ищет TorrServer · ');
    expect(rowTitles()).toEqual(['Dune 2021 TS 720p']);
  });

  it('sorting by seeds through the dialog reorders the rows', async () => {
    useScript(PHONE_DONE);
    mount();
    await searchDune();
    expect(rowTitles()).toEqual([RAW_4K, RAW_HD]);
    act(() => (host.querySelector('.search-sort') as HTMLElement).click());
    const opts = Array.prototype.map.call(host.querySelectorAll('.dialog-option'), (n: Element) => n.textContent);
    expect(opts).toEqual(['По качеству', 'По сидам', 'По размеру', 'По дате']);
    const seeds = Array.prototype.filter.call(host.querySelectorAll('.dialog-option'), (n: Element) => n.textContent === 'По сидам')[0] as HTMLElement;
    act(() => seeds.click());
    await step(10);
    expect(rowTitles()).toEqual([RAW_HD, RAW_4K]);
    expect(host.querySelector('.search-sort')!.textContent).toBe('Сортировка: по сидам');
  });

  it('the blue key opens the release details with the full title; «Добавить» adds it', async () => {
    useScript({ ...PHONE_DONE, resolve: [{ link: MAG }] });
    mount();
    await searchDune();
    act(() => setFocus('res-phone:h1:1'));
    await step(10);
    act(() => {
      dispatchKey('blue', new KeyboardEvent('keydown'));
    });
    const dlg = host.querySelector('.search-details')!;
    expect(dlg.querySelector('.dialog-title')!.textContent).toBe('Подробнее о раздаче');
    expect(dlg.querySelector('.search-details-title')!.textContent).toBe(RAW_HD);
    expect(dlg.textContent).toContain('сиды 300');
    expect(dlg.textContent).toContain('1 мар. 2024');
    act(() => (dlg.querySelector('.button') as HTMLElement).click());
    await step(100);
    expect(host.querySelector('.search-details')).toBeNull();
    expect(calls.filter((c) => c.method === 'resolve').map((c) => c.params)).toEqual([{ handle: 'h1', key: '1' }]);
    expect(addCalls().map((b) => b.link)).toEqual([MAG]);
  });

  it('LG shows the display names of the phone sites', async () => {
    useScript({
      search: [{ handle: 'h3', sourceIds: ['rutracker', 'nnmclub'] }],
      searchPoll: [
        { rev: 1, done: false, pending: ['nnmclub'], answered: ['rutracker'], failed: [], results: [phoneRow('1', RAW_HD, 5, { sources: ['nnmclub', 'torrentby'] })] },
      ],
    });
    mount();
    await searchDune();
    expect(host.querySelector('.search-result')!.textContent).toContain('ещё на NNM-Club, torrent.by');
    expect(host.querySelector('.search-progress')!.textContent).toContain('NNM-Club');
  });

  it('the focused phone row dropped after the fallback hands the cursor to the row at its place', async () => {
    useScript({
      search: [{ handle: 'h4', sourceIds: ['rutracker'] }],
      searchPoll: [
        { rev: 1, done: false, pending: ['rutracker'], answered: [], failed: [], results: [phoneRow('1', RAW_4K, 5, { Hash: HASH }), phoneRow('2', RAW_HD, 3)] },
        new Error('network'),
      ],
    });
    mount();
    typeQuery('Dune');
    act(() => button('Искать').click());
    await step(900);
    expect(rowTitles()).toEqual([RAW_4K, RAW_HD]);
    act(() => setFocus('res-phone:h4:1'));
    await step(10);
    expect(getCurrentFocusKey()).toBe('res-phone:h4:1');
    // two failed polls: TorrServer takes over and finds the same hash, the focused phone row goes
    await step(3000);
    await step(10);
    expect(rowTitles()).not.toContain(RAW_4K);
    const fk = getCurrentFocusKey();
    expect(fk.indexOf('res-')).toBe(0);
    expect(host.querySelector('.search-result.focused')).not.toBeNull();
    expect(fk).toBe(host.querySelectorAll('.search-result')[0].getAttribute('data-fk'));
  });

  it('«Magnet или ссылка» adds the typed link', async () => {
    useScript({});
    askTextMock.mockResolvedValue(MAG);
    mount();
    act(() => button('Magnet или ссылка').click());
    await step(10);
    expect(askTextMock).toHaveBeenCalled();
    expect(addCalls().map((b) => b.link)).toEqual([MAG]);
    expect(calls).toEqual([]);
  });

  it('leaving the screen during a running phone search cancels it', async () => {
    useScript({
      search: [{ handle: 'h9', sourceIds: ['rutracker'] }],
      searchPoll: [{ rev: 1, done: false, pending: ['rutracker'], answered: [], failed: [], results: [] }],
      searchCancel: [{}],
    });
    mount();
    await searchDune();
    act(() => render(null, host));
    await step(10);
    expect(calls.filter((c) => c.method === 'searchCancel').map((c) => c.params)).toEqual([{ handle: 'h9' }]);
  });
});

describe('TV search: names, sizes and the reasons of the phone sites', () => {
  it('shows display names in the chips, the progress line and the failed list, asking the phone for its names once', async () => {
    useScript({
      sources: [{ sources: [{ id: 'jackett-1', name: 'Jackett · home', on: true, state: 'ok' }] }],
      search: [{ handle: 'h5', sourceIds: ['rutor', 'rustorka', 'rutracker', 'jackett-1', 'kinozal'] }],
      searchPoll: [
        { rev: 1, done: false, pending: ['kinozal'], answered: ['rutor'], failed: [], results: [phoneRow('1', RAW_HD, 5, { source: 'rutor', sources: ['rustorka', 'jackett-1'] })] },
        { rev: 1, done: true, pending: [], answered: ['rutor', 'rustorka', 'jackett-1'], failed: [{ id: 'rutracker', message: 'x' }, { id: 'kinozal', message: 'y' }] },
      ],
    });
    mount();
    await searchDune();
    const row = host.querySelector('.search-result')!;
    expect(row.querySelector('.src-badge')!.textContent).toBe('Rutor');
    expect(row.textContent).toContain('ещё на Rustorka, Jackett · home');
    await step(1000);
    expect(host.querySelector('.search-progress')!.textContent).toContain('не ответили: RuTracker, Kinozal');
    // a second search does not ask again
    await searchDune();
    expect(calls.filter((c) => c.method === 'sources')).toHaveLength(1);
  });

  it('the sizes are in the UI language', async () => {
    useScript({
      search: [{ handle: 'h6', sourceIds: ['rutor'] }],
      searchPoll: [{ rev: 2, done: true, pending: [], answered: ['rutor'], failed: [], results: [phoneRow('1', RAW_HD, 7, { Size: '69.35 GB' })] }],
    });
    mount();
    await searchDune();
    expect(host.querySelector('.search-size')!.textContent).toBe('69,4 ГБ · ↑7');
    act(() => render(null, host));
    lang.value = 'en';
    mount();
    typeQuery('Dune');
    act(() => (host.querySelector('[data-fk="add-go"]') as HTMLElement).click());
    await step(2000);
    expect(host.querySelector('.search-size')!.textContent).toBe('69.4 GB · ↑7');
  });

  it('a site that needs a sign-in, a code or a check on the phone says so instead of «не ответили»', async () => {
    useScript({
      search: [{ handle: 'h7', sourceIds: ['rutracker', 'torrentby', 'kinozal', 'nnmclub', 'rutor'] }],
      searchPoll: [
        {
          rev: 2,
          done: true,
          pending: [],
          answered: ['rutor'],
          failed: [
            { id: 'rutracker', message: 'm', code: 'login' },
            { id: 'torrentby', message: 'm', code: 'ipban' },
            { id: 'kinozal', message: 'm', code: 'cloudflare' },
            { id: 'nnmclub', message: 'timeout' },
          ],
          results: [phoneRow('1', RAW_HD, 7, { source: 'rutor' })],
        },
      ],
    });
    mount();
    await searchDune();
    const note = host.querySelector('[data-hint="phone-sites"]')!;
    expect(note.textContent).toBe('RuTracker: нужен вход на телефоне · torrent.by: введите код на телефоне · Kinozal: пройдите проверку на телефоне');
    const progress = host.querySelector('.search-progress')!.textContent!;
    expect(progress).toContain('не ответили: NNM-Club');
    expect(progress).not.toContain('RuTracker');
    act(() => render(null, host));
    lang.value = 'en';
    mount();
    typeQuery('Dune');
    act(() => (host.querySelector('[data-fk="add-go"]') as HTMLElement).click());
    await step(2000);
    expect(host.querySelector('[data-hint="phone-sites"]')!.textContent).toBe(
      'RuTracker: sign in on the phone · torrent.by: enter the code on the phone · Kinozal: pass the check on the phone',
    );
  });
});

describe('TV search: film / series', () => {
  const SERIES = 'Дюна: Пророчество / Dune: Prophecy / Сезон: 1 / Серии: 1-6 из 6 [2024, WEB-DL 1080p]';
  const BARE = 'Dune 1080p WEB-DL';
  const KINDS = {
    search: [{ handle: 'hk', sourceIds: ['rutracker'] }],
    searchPoll: [
      {
        rev: 2,
        done: true,
        pending: [],
        answered: ['rutracker'],
        failed: [],
        results: [phoneRow('1', RAW_HD, 30), phoneRow('2', SERIES, 20), phoneRow('3', BARE, 10)],
      },
    ],
  };
  const kindButtons = () => Array.prototype.slice.call(host.querySelectorAll('.search-kinds .disc-kind')) as HTMLElement[];
  const kindButton = (label: string) => kindButtons().filter((b) => b.textContent === label)[0];
  const badgeOf = (raw: string) => {
    const row = Array.prototype.filter.call(host.querySelectorAll('.search-result'), (n: Element) => n.querySelector('.search-raw')!.textContent === raw)[0] as Element;
    const b = row.querySelector('.search-kind');
    return b ? b.textContent : null;
  };

  afterEach(() => setKindFilter('all'));

  it('each row has its kind badge; nothing for an unknown kind', async () => {
    useScript(KINDS);
    mount();
    await searchDune();
    expect(badgeOf(RAW_HD)).toBe('Фильм');
    expect(badgeOf(SERIES)).toBe('Сериал · S01 · 1–6 из 6');
    expect(badgeOf(BARE)).toBeNull();
  });

  it('«Все / Фильмы / Сериалы» before the sort chip filters the rows; the unknown kind only under «Все»; kept for the session', async () => {
    useScript(KINDS);
    mount();
    await searchDune();
    expect(kindButtons().map((b) => b.textContent)).toEqual(['Все', 'Фильмы', 'Сериалы']);
    expect(kindButton('Все').className).toContain('active');
    expect(rowTitles().length).toBe(3);
    act(() => kindButton('Сериалы').click());
    expect(rowTitles()).toEqual([SERIES]);
    expect(kindButton('Сериалы').className).toContain('active');
    expect(host.querySelector('.search-progress')!.textContent).toContain('1');
    act(() => kindButton('Фильмы').click());
    expect(rowTitles()).toEqual([RAW_HD]);
    // focusable with the remote: the spatial navigation knows the three
    act(() => setFocus('search-kind-series'));
    await step(10);
    expect(getCurrentFocusKey()).toBe('search-kind-series');
    expect(kindButton('Сериалы').className).toContain('focused');
    // the screen again: the filter is still «Фильмы»
    act(() => render(null, host));
    mount();
    await searchDune();
    expect(kindButton('Фильмы').className).toContain('active');
    expect(rowTitles()).toEqual([RAW_HD]);
  });

  it('a filter with no rows says so instead of «Ничего не найдено»', async () => {
    useScript({ ...KINDS, searchPoll: [{ ...KINDS.searchPoll[0], results: [phoneRow('1', RAW_HD, 30)] }] });
    mount();
    await searchDune();
    act(() => kindButton('Сериалы').click());
    expect(rowTitles()).toEqual([]);
    expect(host.querySelector('[data-hint="nothing"]')).toBeNull();
    expect(host.querySelector('[data-hint="no-kind"]')!.textContent).toBe('Нет раздач этого типа — выберите «Все»');
  });
});

describe('TV search: rows unrelated to the query', () => {
  it('drops the latest-list rows of a site that ignores the query, and says nothing was found when none is left', async () => {
    useScript({
      search: [{ handle: 'h8', sourceIds: ['anidub', 'rutracker'] }],
      searchPoll: [
        {
          rev: 2,
          done: true,
          pending: [],
          answered: ['anidub', 'rutracker'],
          failed: [],
          results: [
            phoneRow('1', 'Понедельник - день тяжелый / Getsuyoubi no Tawawa [TV] 1080p', 40, { source: 'anidub' }),
            phoneRow('2', 'Виви: Песнь флюоритового глаза 1080p', 30, { source: 'anidub' }),
            phoneRow('3', RAW_HD, 10),
          ],
        },
      ],
    });
    mount();
    typeQuery('Дюна 2021 720p');
    act(() => button('Искать').click());
    await step(2000);
    expect(rowTitles()).toEqual([RAW_HD]);
    expect(host.querySelector('[data-hint="nothing"]')).toBeNull();
  });

  it('only junk: «Ничего не найдено», no rows', async () => {
    useScript({
      search: [{ handle: 'h9', sourceIds: ['anidub'] }],
      searchPoll: [
        { rev: 2, done: true, pending: [], answered: ['anidub'], failed: [], results: [phoneRow('1', 'Виви: Песнь флюоритового глаза', 30, { source: 'anidub' })] },
      ],
    });
    mount();
    typeQuery('Дюна 2021 720p');
    act(() => button('Искать').click());
    await step(2000);
    expect(rowTitles()).toEqual([]);
    expect(host.querySelector('[data-hint="nothing"]')!.textContent).toBe('Ничего не найдено');
  });
});


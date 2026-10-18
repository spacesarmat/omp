// «Новое» → «Подписки»: the search over subscriptions and their findings, the sort (tsp.subsSort) and «Проверить
// сейчас» for one subscription (Task 9j).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../src/monitor/check', async (orig) => ({
  ...(await orig<typeof import('../../src/monitor/check')>()),
  checkSubscription: vi.fn(),
}));

import { News, resetNews } from '../src/screens/News';
import { SubFindings } from '../src/screens/SubFindings';
import { resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { fakeMonitor, type FakeMonitor } from './fakeMonitor';
import { applyLanguageSetting } from '../../src/i18n';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { torrents } from '../../src/store/library';
import { reloadSourcePrefs, resetHealth } from '../../src/sources/store';
import { addFindings, addSubscription, findingsOf } from '../../src/monitor/subs';
import { checkSubscription } from '../../src/monitor/check';
import { checkingSubs, compareName, compareSubs, filterSubs, loadSubsSort, matchFindings, saveSubsSort, searchKey, sortFindings, sortSubs, SUBS_SORT_KEY, SUBS_SORTS } from '../src/monitor/subsView';
import type { Finding, Subscription } from '../../src/monitor/types';
import type { SourceResult } from '../../src/sources/types';

const checkMock = checkSubscription as unknown as ReturnType<typeof vi.fn>;
let el: HTMLElement;
let mon: FakeMonitor;

function res(title: string, p: Partial<SourceResult> = {}): SourceResult {
  return { Title: title, Categories: '', Size: '4,2 ГБ', CreateDate: '', Tracker: '', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 12, source: 'rutor', ...p };
}

function finding(subId: string, key: string, title: string, p: Partial<Finding> = {}): Finding {
  return { subId, key, at: 1000, result: res(title), ...p };
}

function sub(p: Partial<Subscription>): Subscription {
  return { id: 'x', query: 'x', quality: '', sources: null, notify: true, createdAt: 1, ...p };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
const byText = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t);
const click = (n: Element | undefined | null) => {
  if (!n) throw new Error('missing element');
  act(() => (n as HTMLElement).click());
};
const subRows = () => Array.from(el.querySelectorAll('.m-sub-row .m-sub-q')).map((n) => n.textContent);
const search = () => el.querySelector('input[data-subs-search]') as HTMLInputElement | null;
function type(text: string) {
  const i = search();
  if (!i) throw new Error('no search field');
  act(() => {
    i.value = text;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mountNews() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => render(<News seg="subs" />, el));
  await flush();
}

async function mountSub(id: string) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => render(<SubFindings id={id} />, el));
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetHealth();
  resetNews();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  torrents.value = [];
  toast.value = '';
  checkMock.mockReset();
  checkingSubs.value = [];
  resetTo({ name: 'news' });
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  mon = fakeMonitor();
});

afterEach(() => {
  if (el) act(() => render(null, el));
  mon.restore();
  vi.restoreAllMocks();
  applyLanguageSetting('ru');
});

describe('subscriptions search helpers', () => {
  it('normalises case, ё/е and spaces', () => {
    expect(searchKey('  Ёлки   ПАЛКИ ')).toBe('елки палки');
  });

  it('filters subscriptions by query text, ё = е, case-insensitive', () => {
    const list = [sub({ id: 'a', query: 'Ёлки 2' }), sub({ id: 'b', query: 'Дюна' }), sub({ id: 'c', query: 'елка' })];
    expect(filterSubs(list, 'ЕЛК').map((s) => s.id)).toEqual(['a', 'c']);
    expect(filterSubs(list, '  ').map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('matches finding titles of subscriptions only and caps the list', () => {
    const all = [
      finding('s1', 'k1', 'Дюна 2160p'),
      finding('episodes', 'k2', 'Дюна сериал'),
      finding('better', 'k3', 'Дюна 4K'),
      finding('s2', 'k4', 'Другое кино'),
    ];
    expect(matchFindings('дюна', all).shown.map((f) => f.key)).toEqual(['k1']);
    const many = Array.from({ length: 7 }, (_, i) => finding('s1', 'm' + i, 'Ёжик ' + i));
    const r = matchFindings('ежик', many, 5);
    expect(r.shown).toHaveLength(5);
    expect(r.more).toBe(2);
    expect(matchFindings('', many).shown).toEqual([]);
  });

  it('sorts by date added (default), new findings, name, quality and find age; ties break by name', () => {
    const list = [
      sub({ id: 'vega', query: 'Вега', createdAt: 3, quality: '720', lastFindAt: 50 }),
      sub({ id: 'alpha', query: 'Альфа', createdAt: 1, quality: '', lastFindAt: 10 }),
      sub({ id: 'beta', query: 'Бета', createdAt: 2, quality: '2160' }),
      sub({ id: 'gamma', query: 'Гамма', createdAt: 2, quality: '1080', lastFindAt: 10 }),
    ];
    // newest createdAt first; Бета and Гамма share 2, so name decides (Бета before Гамма)
    expect(sortSubs(list, 'added').map((s) => s.id)).toEqual(['vega', 'beta', 'gamma', 'alpha']);
    // most recent find first; never-found (Бета) last
    expect(sortSubs(list, 'fresh').map((s) => s.id)).toEqual(['vega', 'alpha', 'gamma', 'beta']);
    // never-found first, then the oldest find; Альфа and Гамма share 10, name decides
    expect(sortSubs(list, 'stale').map((s) => s.id)).toEqual(['beta', 'alpha', 'gamma', 'vega']);
    expect(sortSubs(list, 'name').map((s) => s.id)).toEqual(['alpha', 'beta', 'vega', 'gamma']);
    // 2160, 1080, 720, любое качество
    expect(sortSubs(list, 'quality').map((s) => s.id)).toEqual(['beta', 'gamma', 'vega', 'alpha']);
    expect(compareSubs(list[2], list[3], 'added')).toBeLessThan(0);
  });

  it('orders names A–Я for Russian and English, ignoring case and ё/е, with numbers in order', () => {
    expect(compareName('Дюна', 'дюна')).toBe(0);
    expect(compareName('Ёлка', 'елка')).toBe(0);
    expect(compareName('Аватар', 'Бета')).toBeLessThan(0);
    expect(compareName('Сезон 2', 'Сезон 10')).toBeLessThan(0);
    expect(compareName('яблоко', 'Apple')).toBeLessThan(0);
    const list = [
      sub({ id: 'p', query: 'President Curtis' }),
      sub({ id: 'ye', query: 'елка' }),
      sub({ id: 'yo', query: 'Ёлки' }),
      sub({ id: 'a', query: 'Аватар' }),
      sub({ id: 'ap', query: 'Apple' }),
      sub({ id: 'z', query: 'яблоко' }),
    ];
    expect(sortSubs(list, 'name').map((s) => s.id)).toEqual(['a', 'ye', 'yo', 'z', 'ap', 'p']);
    // equal names keep the input order
    const same = [sub({ id: '1', query: 'Елка', createdAt: 5 }), sub({ id: '2', query: 'ёлка', createdAt: 5 })];
    expect(sortSubs(same, 'added').map((s) => s.id)).toEqual(['1', '2']);
    expect(sortSubs(same, 'name').map((s) => s.id)).toEqual(['1', '2']);
  });

  it('sorts found releases with the same choice, following the subscription order', () => {
    const subs = [
      sub({ id: 'hi', query: 'Игра', quality: '2160', createdAt: 1, lastFindAt: 5 }),
      sub({ id: 'lo', query: 'Альфа', quality: '', createdAt: 9, lastFindAt: 50 }),
    ];
    const all = [
      finding('lo', 'lo1', 'Альфа 2160p', { at: 50 }),
      finding('hi', 'hi1', 'Игра 720p', { at: 5 }),
      finding('hi', 'hi2', 'Игра 1080p', { at: 4 }),
    ];
    // requested quality, not the release's: the 2160 subscription's older 720p row comes before a 2160p release of «любое»
    expect(sortFindings(all, 'quality', subs).map((f) => f.key)).toEqual(['hi2', 'hi1', 'lo1']);
    expect(sortFindings(all, 'added', subs).map((f) => f.key)).toEqual(['lo1', 'hi1', 'hi2']);
    expect(sortFindings(all, 'fresh', subs).map((f) => f.key)).toEqual(['lo1', 'hi1', 'hi2']);
    expect(sortFindings(all, 'stale', subs).map((f) => f.key)).toEqual(['hi2', 'hi1', 'lo1']);
    expect(sortFindings(all, 'name', subs).map((f) => f.key)).toEqual(['lo1', 'hi1', 'hi2']);
    // inside one subscription the release quality still orders the rows
    expect(sortFindings([all[1], all[2]], 'quality', subs).map((f) => f.key)).toEqual(['hi2', 'hi1']);
    const matched = matchFindings('игра', all, 50, 'quality', subs);
    expect(matched.shown.map((f) => f.key)).toEqual(['hi2', 'hi1']);
  });

  it('persists the sort; a choice that was never stored becomes «по дате добавления»', () => {
    expect(loadSubsSort()).toBe('added');
    expect(localStorage.getItem(SUBS_SORT_KEY)).toBeNull();
    saveSubsSort('name');
    expect(localStorage.getItem(SUBS_SORT_KEY)).toBe('"name"');
    expect(loadSubsSort()).toBe('name');
    localStorage.setItem(SUBS_SORT_KEY, '"fresh"');
    expect(loadSubsSort()).toBe('fresh');
    SUBS_SORTS.forEach((s) => {
      saveSubsSort(s);
      expect(loadSubsSort()).toBe(s);
    });
    localStorage.setItem(SUBS_SORT_KEY, '"bogus"');
    expect(loadSubsSort()).toBe('added');
    localStorage.setItem(SUBS_SORT_KEY, '{');
    expect(loadSubsSort()).toBe('added');
  });
});

describe('«Подписки» search and sort on screen', () => {
  function seed() {
    const a = addSubscription({ query: 'Ёлки', quality: '', sources: null, notify: true }, 100)!;
    const b = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true }, 300)!;
    const c = addSubscription({ query: 'Аватар', quality: '', sources: null, notify: true }, 200)!;
    addFindings([finding(b.id, 'b1', 'Дюна: Часть вторая 2160p', { at: 5 }), finding(b.id, 'b2', 'Дюна 1080p', { at: 4 }), finding(a.id, 'a1', 'Ёлки 11 WEB-DL', { at: 3, seen: true })]);
    return { a, b, c };
  }

  it('filters the rows live, ё = е, and the clear button brings them back', async () => {
    seed();
    await mountNews();
    expect(subRows()).toEqual(['Дюна', 'Аватар', 'Ёлки']);
    type('ЕЛКИ');
    expect(subRows()).toEqual(['Ёлки']);
    type('нет такого');
    expect(subRows()).toEqual([]);
    expect(el.textContent).toContain('Подписок с таким названием нет');
    click(el.querySelector('[data-subs-clear]'));
    expect(search()!.value).toBe('');
    expect(subRows()).toEqual(['Дюна', 'Аватар', 'Ёлки']);
  });

  it('shows «Найденные раздачи» matching release titles of all subscriptions', async () => {
    seed();
    await mountNews();
    expect(el.textContent).not.toContain('Найденные раздачи');
    type('2160');
    expect(subRows()).toEqual([]);
    const sec = el.querySelector('[data-found-releases]')!;
    expect(sec.textContent).toContain('Найденные раздачи');
    // the full release title is the card's data-title (on screen it is in the card's «Подробнее»)
    const found = () => Array.from(el.querySelectorAll('[data-found-releases] [data-title]')).map((n) => n.getAttribute('data-title'));
    expect(found()).toContain('Дюна: Часть вторая 2160p');
    expect(found()).not.toContain('Дюна 1080p');
    type('ёлки');
    expect(found().join('|')).toContain('Ёлки 11 WEB-DL');
  });

  it('caps the findings section with a «ещё N» note', async () => {
    const s = addSubscription({ query: 'Сериал', quality: '', sources: null, notify: true }, 1)!;
    addFindings(Array.from({ length: 53 }, (_, i) => finding(s.id, 'k' + i, 'Сериал серия ' + i, { at: 100 + i })));
    await mountNews();
    type('серия');
    const sec = el.querySelector('[data-found-releases]')!;
    expect(sec.querySelectorAll('.m-result, [data-result]').length || sec.querySelectorAll('.m-results > *').length).toBe(50);
    expect(sec.textContent).toContain('и ещё 3 раздачи');
  });

  it('sorts by date added by default; every chip reorders the list and the choice sticks', async () => {
    const a = addSubscription({ query: 'Ёлки', quality: '', sources: null, notify: true }, 100)!;
    const b = addSubscription({ query: 'Дюна', quality: '2160', sources: null, notify: true }, 300)!;
    const c = addSubscription({ query: 'Аватар', quality: '1080', sources: null, notify: true }, 200)!;
    addSubscription({ query: 'Бета', quality: '720', sources: null, notify: true }, 400);
    addFindings([
      finding(b.id, 'b1', 'Дюна 2160p', { at: 50 }),
      finding(a.id, 'a1', 'Ёлки 11', { at: 10 }),
      finding(c.id, 'c1', 'Аватар 1080p', { at: 20 }),
    ]);
    await mountNews();
    const chips = () => Array.from(el.querySelectorAll('.m-subs-sort .m-chip')).map((n) => n.textContent);
    expect(chips()).toEqual(['по дате добавления', 'новые находки', 'по имени', 'по качеству', 'по давности находок']);
    expect(el.querySelector('.m-subs-sort')!.getAttribute('style')).toBeNull();
    expect(byText('по дате добавления')!.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(SUBS_SORT_KEY)).toBeNull();
    // newest subscription first: Бета 400, Дюна 300, Аватар 200, Ёлки 100
    expect(subRows()).toEqual(['Бета', 'Дюна', 'Аватар', 'Ёлки']);
    click(byText('новые находки'));
    // last find: Дюна 50, Аватар 20, Ёлки 10, Бета never
    expect(subRows()).toEqual(['Дюна', 'Аватар', 'Ёлки', 'Бета']);
    click(byText('по имени'));
    expect(subRows()).toEqual(['Аватар', 'Бета', 'Дюна', 'Ёлки']);
    click(byText('по качеству'));
    expect(subRows()).toEqual(['Дюна', 'Аватар', 'Бета', 'Ёлки']);
    click(byText('по давности находок'));
    expect(subRows()).toEqual(['Бета', 'Ёлки', 'Аватар', 'Дюна']);
    expect(localStorage.getItem(SUBS_SORT_KEY)).toBe('"stale"');
    type('та');
    // «та» is in Аватар and Бета; stale order keeps Бета (never found) before Аватар
    expect(subRows()).toEqual(['Бета', 'Аватар']);
    click(byText('по имени'));
    expect(subRows()).toEqual(['Аватар', 'Бета']);
    click(el.querySelector('[data-subs-clear]'));
    expect(subRows()).toEqual(['Аватар', 'Бета', 'Дюна', 'Ёлки']);
    act(() => render(null, el));
    await mountNews();
    expect(byText('по имени')!.getAttribute('aria-pressed')).toBe('true');
    expect(subRows()).toEqual(['Аватар', 'Бета', 'Дюна', 'Ёлки']);
  });

  it('hides the sort with one subscription', async () => {
    addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true }, 1);
    await mountNews();
    expect(byText('по имени')).toBeUndefined();
    expect(search()).not.toBeNull();
  });
});

describe('«Проверить сейчас» for one subscription', () => {
  it('calls checkSubscription once for that subscription, shows «Проверяю…» and the count', async () => {
    const s = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true, better: true }, 1)!;
    addSubscription({ query: 'Другое', quality: '', sources: null, notify: true }, 2);
    let finish: (v: unknown) => void = () => {};
    checkMock.mockImplementation(() => new Promise((r) => (finish = r)));
    await mountSub(s.id);
    click(el.querySelector('[data-check-sub]'));
    await flush();
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(checkMock.mock.calls[0][1].id).toBe(s.id);
    expect(checkMock.mock.calls[0][1].better).toBe(true);
    const btn = el.querySelector('[data-check-sub]') as HTMLButtonElement;
    expect(btn.textContent).toBe('Проверяю…');
    expect(btn.disabled).toBe(true);
    // a second tap while it runs does not start another check
    click(btn);
    expect(checkMock).toHaveBeenCalledTimes(1);
    const f = finding(s.id, 'n1', 'Дюна 2160p');
    addFindings([f]);
    await act(async () => finish({ sub: s, findings: [f], first: false, answered: ['rutor'], failed: [] }));
    await flush();
    expect(toast.value).toBe('Найдено новых: 1');
    expect((el.querySelector('[data-check-sub]') as HTMLButtonElement).textContent).toBe('Проверить сейчас');
    expect(findingsOf(s.id)).toHaveLength(1);
    expect(el.querySelector('[data-title="Дюна 2160p"]')).toBeTruthy();
  });

  it('says «Новых раздач нет», the first-check note, or that the sites did not answer', async () => {
    const s = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true }, 1)!;
    await mountSub(s.id);
    checkMock.mockResolvedValueOnce({ sub: s, findings: [], first: false, answered: ['rutor'], failed: [] });
    click(el.querySelector('[data-check-sub]'));
    await flush();
    expect(toast.value).toBe('Новых раздач нет');
    checkMock.mockResolvedValueOnce({ sub: s, findings: [], first: true, answered: ['rutor'], failed: [] });
    click(el.querySelector('[data-check-sub]'));
    await flush();
    expect(toast.value).toContain('Первая проверка');
    checkMock.mockResolvedValueOnce({ sub: s, findings: [], first: false, answered: [], failed: ['rutor'] });
    click(el.querySelector('[data-check-sub]'));
    await flush();
    expect(toast.value).toBe('Сайты не ответили — попробуйте позже');
  });
});

describe('in English', () => {
  it('renders the search, the sort, the findings section and the single check in English', async () => {
    applyLanguageSetting('en');
    const s = addSubscription({ query: 'Dune', quality: '', sources: null, notify: true }, 1)!;
    addSubscription({ query: 'Avatar', quality: '', sources: null, notify: true }, 2);
    addFindings([finding(s.id, 'd1', 'Dune Part Two 2160p', { result: res('Dune Part Two 2160p', { Size: '4.2 GB' }) })]);
    await mountNews();
    expect(search()!.getAttribute('placeholder')).toBe('Search subscriptions and found releases');
    expect(el.textContent).toContain('Sort');
    expect(byText('by date added')!.getAttribute('aria-pressed')).toBe('true');
    expect(byText('new findings')).toBeDefined();
    expect(byText('by name')).toBeDefined();
    expect(byText('by quality')).toBeDefined();
    expect(byText('by find age')).toBeDefined();
    type('part two');
    expect(el.querySelector('[data-found-releases]')!.textContent).toContain('Found releases');
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
    act(() => render(null, el));
    checkMock.mockResolvedValueOnce({ sub: s, findings: [], first: false, answered: ['rutor'], failed: [] });
    await mountSub(s.id);
    const btn = el.querySelector('[data-check-sub]')!;
    expect(btn.textContent).toBe('Check now');
    click(btn);
    await flush();
    expect(toast.value).toBe('No new torrents');
  });
});

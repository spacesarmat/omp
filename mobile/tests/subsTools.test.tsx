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
import { checkingSubs, filterSubs, loadSubsSort, matchFindings, saveSubsSort, searchKey, sortSubs, SUBS_SORT_KEY } from '../src/monitor/subsView';
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

  it('sorts by new findings, name and date added', () => {
    const list = [sub({ id: 'a', query: 'Вега', createdAt: 3 }), sub({ id: 'b', query: 'Альфа', createdAt: 1 }), sub({ id: 'c', query: 'Бета', createdAt: 2 })];
    const unseen = (id: string) => (id === 'c' ? 2 : id === 'a' ? 1 : 0);
    expect(sortSubs(list, 'fresh', unseen).map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(sortSubs(list, 'name', unseen).map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(sortSubs(list, 'added', unseen).map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('persists the sort, sanitized', () => {
    expect(loadSubsSort()).toBe('fresh');
    saveSubsSort('name');
    expect(localStorage.getItem(SUBS_SORT_KEY)).toBe('"name"');
    expect(loadSubsSort()).toBe('name');
    localStorage.setItem(SUBS_SORT_KEY, '"bogus"');
    expect(loadSubsSort()).toBe('fresh');
    localStorage.setItem(SUBS_SORT_KEY, '{');
    expect(loadSubsSort()).toBe('fresh');
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

  it('sorts by new findings by default; the choice sticks in tsp.subsSort', async () => {
    seed();
    await mountNews();
    expect(subRows()).toEqual(['Дюна', 'Аватар', 'Ёлки']);
    click(byText('по имени'));
    expect(subRows()).toEqual(['Аватар', 'Дюна', 'Ёлки']);
    expect(localStorage.getItem(SUBS_SORT_KEY)).toBe('"name"');
    click(byText('по дате добавления'));
    expect(subRows()).toEqual(['Дюна', 'Аватар', 'Ёлки']);
    act(() => render(null, el));
    await mountNews();
    expect(byText('по дате добавления')!.getAttribute('aria-pressed')).toBe('true');
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
    expect(byText('new findings')).toBeDefined();
    expect(byText('by name')).toBeDefined();
    expect(byText('by date added')).toBeDefined();
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

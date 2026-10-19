// Monitoring without the OMP subscription: the 11th subscription is refused with a sheet, the ones above 10 are paused
// (dimmed, not checked by the app, the background page or the TV), «N из 10» by the header; with the subscription none of it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { News, resetNews } from '../src/screens/News';
import { SubSheet } from '../src/ui/SubSheet';
import { SubFindings } from '../src/screens/SubFindings';
import { WantSheet } from '../src/screens/catalog/WantSheet';
import { checkSubNow } from '../src/monitor/subsView';
import { currentRoute, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { fakeMonitor, type FakeMonitor } from './fakeMonitor';
import { reloadSourcePrefs } from '../../src/sources/store';
import { loadSubs, saveSubs } from '../../src/monitor/subs';
import { saveBillingSession, emitBillingChange } from '../../src/billing/session';
import { ompSubscribed } from '../../src/billing/entitlement';
import { clearBilling, fetchBillingAccount } from '../../src/sources/ompJackett';
import { createRpcHandler } from '../src/rpc/handler';
import { runMonitor, type PageDeps } from '../src/monitor/page';
import type { MonitorHost } from '../src/monitor/host';
import type { SearchFn } from '../../src/monitor/check';
import type { NativeHttpRequest } from '../../src/sources/http';
import type { SourceContext } from '../../src/sources/types';
import type { Subscription } from '../../src/monitor/types';
import type { CatalogCard } from '../../src/catalog/tmdb';

const DAY = 24 * 60 * 60 * 1000;
let el: HTMLElement;
let mon: FakeMonitor;

const sub = (i: number): Subscription => ({ id: 's' + i, query: 'Сериал ' + i, quality: '', sources: null, notify: true, createdAt: i });
/** s1 is the oldest; stored newest first, as a list that grew by hand would not be. */
const many = (n: number) => Array.from({ length: n }, (_, i) => sub(n - i));
const subscribe = () => {
  saveBillingSession({ token: 'tok', paidUntil: Date.now() + 10 * DAY });
  emitBillingChange();
};

const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
const byText = (t: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === t);
const click = (n: Element | undefined | null) => {
  if (!n) throw new Error('missing element');
  act(() => (n as HTMLElement).click());
};
async function mount(node: preact.ComponentChild) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => render(node, el));
  await flush();
}

const LIMIT_TEXT = 'Без подписки OMP — до 10 подписок. Оформите подписку, чтобы отслеживать больше';

beforeEach(() => {
  localStorage.clear();
  reloadSourcePrefs();
  resetNews();
  resetTo({ name: 'news' });
  toast.value = '';
  mon = fakeMonitor();
});

afterEach(() => {
  if (el) act(() => render(null, el));
  mon.restore();
  vi.restoreAllMocks();
});

describe('adding past the cap', () => {
  it('«+ Новая подписка» at 10 opens the limit sheet; its button leads to the OMP subscription', async () => {
    saveSubs(many(10));
    await mount(<News seg="subs" />);
    click(byText('+ Новая подписка'));
    expect(el.querySelector('[data-subs-limit]')!.textContent).toBe(LIMIT_TEXT);
    expect(el.querySelector('#m-sub-query')).toBeNull();
    click(byText('Оформить подписку OMP'));
    expect(currentRoute.value).toEqual({ name: 'account' });
    expect(loadSubs()).toHaveLength(10);
  });

  it('SubSheet in create mode shows the limit instead of the form; editing an existing one still works', async () => {
    saveSubs(many(10));
    await mount(<SubSheet onClose={() => {}} />);
    expect(el.textContent).toContain(LIMIT_TEXT);
    await mount(<SubSheet sub={sub(3)} onClose={() => {}} />);
    expect(el.querySelector('#m-sub-query')).not.toBeNull();
  });

  it('SubSheet: the 10th is saved, the form opened at 9 refuses the 11th made meanwhile', async () => {
    saveSubs(many(9));
    await mount(<SubSheet initial={{ query: 'Десятая' }} onClose={() => {}} />);
    saveSubs(many(10));
    click(byText('Сохранить'));
    expect(el.textContent).toContain(LIMIT_TEXT);
    expect(loadSubs()).toHaveLength(10);
  });

  it('«Хочу посмотреть» from the catalog refuses the 11th', async () => {
    saveSubs(many(10));
    const card = { kind: 'movie', id: 1, title: 'Фильм', original: 'Фильм', year: 2026, poster: '', rating: 0, backdrop: '', genres: [], runtime: 0, overview: '', cast: [], seasons: [], airing: false } as CatalogCard;
    await mount(<WantSheet card={card} onClose={() => {}} />);
    expect(el.textContent).toContain(LIMIT_TEXT);
  });

  it('with the subscription there is no cap', async () => {
    subscribe();
    saveSubs(many(10));
    await mount(<SubSheet initial={{ query: 'Одиннадцатая' }} onClose={() => {}} />);
    click(byText('Сохранить'));
    expect(loadSubs()).toHaveLength(11);
  });
});

describe('the list: quota and pause', () => {
  it('«7 из 10» by the header without the subscription, none with it', async () => {
    saveSubs(many(7));
    await mount(<News seg="subs" />);
    expect(el.querySelector('[data-subs-quota]')!.textContent).toBe(' · 7 из 10');
    act(() => subscribe());
    await flush();
    expect(el.querySelector('[data-subs-quota]')).toBeNull();
  });

  it('above 10: the newest are dimmed «на паузе — нужна подписка OMP»; subscribing lifts it, nothing is deleted', async () => {
    saveSubs(many(12));
    await mount(<News seg="subs" />);
    const paused = () => Array.from(el.querySelectorAll('.m-sub-row[data-paused]')).map((n) => n.querySelector('.m-sub-q')!.textContent);
    expect(paused().sort()).toEqual(['Сериал 11', 'Сериал 12']);
    expect(el.querySelector('.m-sub-paused .m-sub-paused-note')!.textContent).toBe('на паузе — нужна подписка OMP');
    expect(el.querySelector('[data-subs-quota]')!.textContent).toBe(' · 12 из 10');
    act(() => subscribe());
    await flush();
    expect(paused()).toEqual([]);
    act(() => clearBilling());
    await flush();
    expect(paused()).toHaveLength(2);
    expect(loadSubs()).toHaveLength(12);
  });

  it('a paused subscription is not checked from its screen', async () => {
    saveSubs(many(11));
    await mount(<SubFindings id="s11" />);
    expect(el.querySelector('[data-check-sub]')).toBeNull();
    expect(el.querySelector('[data-sub-paused]')!.textContent).toBe('Подписка на паузе: без подписки OMP проверяются только первые 10');
    await checkSubNow('s11');
    expect(toast.value).toBe('Подписка на паузе: без подписки OMP проверяются только первые 10');
    await mount(<SubFindings id="s1" />);
    expect(el.querySelector('[data-check-sub]')).not.toBeNull();
  });
});

describe('the TV over RPC', () => {
  const deps = () => ({
    sources: () => [],
    ctx: () => ({}) as never,
    now: () => 1_000,
    checkSubscription: vi.fn(() => Promise.resolve({ findings: [], first: false, answered: 1, failed: 0 })),
  });

  it('wantAdd past the cap answers with the phone’s reason; subs marks the paused; subCheck refuses them', async () => {
    saveSubs(many(10));
    const d = deps();
    const rpc = createRpcHandler(d as never);
    await expect(rpc.dispatch('wantAdd', { query: 'Новый фильм' })).rejects.toMatchObject({
      code: 'failed',
      message: 'На телефоне уже 10 подписок — без подписки OMP больше не добавить.',
    });
    // already followed: answered as before, not refused
    await expect(rpc.dispatch('wantAdd', { query: 'сериал 3' })).resolves.toMatchObject({ created: false });
    saveSubs(many(11));
    const r = (await rpc.dispatch('subs', {})) as { subs: { id: string; paused?: boolean }[] };
    expect(r.subs.filter((s) => s.paused).map((s) => s.id)).toEqual(['s11']);
    await expect(rpc.dispatch('subCheck', { id: 's11' })).rejects.toMatchObject({ code: 'failed' });
    expect(d.checkSubscription).not.toHaveBeenCalled();
    subscribe();
    await expect(rpc.dispatch('wantAdd', { query: 'Новый фильм' })).resolves.toMatchObject({ created: true });
    await rpc.dispatch('subCheck', { id: 's11' });
    expect(d.checkSubscription).toHaveBeenCalledTimes(1);
  });
});

describe('the background check', () => {
  function host(calls: NativeHttpRequest[]): MonitorHost {
    return {
      start: () => Promise.resolve({ action: null, deadline: Date.now() + 180_000, journal: [] }),
      http: (req) => {
        calls.push(req);
        return Promise.reject(new Error('no network in tests'));
      },
      secretGet: () => Promise.resolve({ value: null }),
      billingRefresh: () => Promise.resolve({ ok: false, error: 'network' }),
      notify: () => Promise.resolve(true),
      setCleartext: () => Promise.resolve(),
      persist: () => Promise.resolve(),
      finish: () => undefined,
    } as MonitorHost;
  }
  function search(queries: string[]): SearchFn {
    return (query) => {
      queries.push(query);
      return { sourceIds: ['rutor'], results: () => [], pending: () => [], answered: () => ['rutor'], failed: () => [], done: Promise.resolve(), cancel: () => undefined };
    };
  }
  const deps = (h: MonitorHost, queries: string[]): PageDeps => ({ host: h, client: () => null, feed: { from: [] }, check: { search: search(queries) } });

  it('checks only the 10 oldest without the subscription, all of them with it', async () => {
    saveSubs(many(12));
    const q1: string[] = [];
    const calls: NativeHttpRequest[] = [];
    const s1 = await runMonitor(deps(host(calls), q1));
    expect(q1.sort()).toEqual(many(10).map((s) => s.query).sort());
    expect(s1.subs).toBe(10);
    expect(calls).toEqual([]); // no session: billing is not asked

    subscribe();
    const q2: string[] = [];
    const calls2: NativeHttpRequest[] = [];
    const s2 = await runMonitor(deps(host(calls2), q2));
    expect(q2).toHaveLength(12);
    expect(s2.subs).toBe(12);
    // over the cap with a session: /v1/me is asked first (here it fails, the session date still counts)
    expect(calls2.some((r) => /\/v1\/me$/.test(r.url))).toBe(true);
  });
});

describe('the background check after the pause', () => {
  const results = (titles: string[]) => titles.map((Title, i) => ({ Title, Categories: '', Size: '1 ГБ', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: 'magnet:?xt=urn:btih:' + String(i + 1).repeat(40).slice(0, 40), Hash: '', Peer: 0, Seed: 10, source: 'rutor' }));
  function host(notes: string[]): MonitorHost {
    return {
      start: () => Promise.resolve({ action: null, deadline: Date.now() + 180_000, journal: [] }),
      http: () => Promise.reject(new Error('no network in tests')),
      secretGet: () => Promise.resolve({ value: null }),
      notify: (n: { title: string }) => {
        notes.push(n.title);
        return Promise.resolve(true);
      },
      setCleartext: () => Promise.resolve(),
      persist: () => Promise.resolve(),
      finish: () => undefined,
    } as unknown as MonitorHost;
  }
  const search = (pages: { [q: string]: ReturnType<typeof results> }): SearchFn => (query) => ({
    sourceIds: ['rutor'], results: () => (pages[query] || []).slice(), pending: () => [], answered: () => ['rutor'], failed: () => [], done: Promise.resolve(), cancel: () => undefined,
  });

  it('what came out during the pause is recorded silently; later releases are reported again', async () => {
    saveSubs(many(11));
    const q = 'Сериал 11';
    const pages: { [q: string]: ReturnType<typeof results> } = { [q]: results(['Сериал 11 серия 1']) };
    // checked once while the subscription was on: its seen results exist
    subscribe();
    await runMonitor({ host: host([]), client: () => null, feed: { from: [] }, check: { search: search(pages) } });
    clearBilling();
    const paused: string[] = [];
    await runMonitor({ host: host(paused), client: () => null, feed: { from: [] }, check: { search: search(pages) } });
    // released during the pause
    pages[q] = results(['Сериал 11 серия 1', 'Сериал 11 серия 2', 'Сериал 11 серия 3']);
    subscribe();
    const back: string[] = [];
    await runMonitor({ host: host(back), client: () => null, feed: { from: [] }, check: { search: search(pages) } });
    expect(back).toEqual([]);
    pages[q] = results(['Сериал 11 серия 1', 'Сериал 11 серия 2', 'Сериал 11 серия 3', 'Сериал 11 серия 4']);
    const later: string[] = [];
    await runMonitor({ host: host(later), client: () => null, feed: { from: [] }, check: { search: search(pages) } });
    expect(later).toEqual(['Сериал 11: 1 новая раздача']);
  });
});

describe('/v1/me feeds the cached state', () => {
  it('an inactive answer (e.g. over the device limit) turns the cap on; an active one in grace keeps it off', async () => {
    subscribe();
    const answer = (body: object): SourceContext =>
      ({ http: { get: () => Promise.resolve({ status: 200, text: JSON.stringify(body), headers: {} }), post: () => Promise.reject(new Error('x')) }, client: null }) as unknown as SourceContext;
    expect(ompSubscribed()).toBe(true);
    await fetchBillingAccount(answer({ paidUntil: Date.now() + 10 * DAY, active: false, overLimit: true }));
    expect(ompSubscribed()).toBe(false);
    await fetchBillingAccount(answer({ paidUntil: Date.now() - DAY, active: true, inGrace: true, accessUntil: Date.now() + 2 * DAY }));
    expect(ompSubscribed()).toBe(true);
  });
});

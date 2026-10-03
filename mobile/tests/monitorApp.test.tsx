import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from '../src/app';
import { native } from '../src/platform/native';
import { currentRoute, routeStack, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { parseNewsLink } from '../src/monitor/ui';
import { fakeMonitor, type FakeMonitor } from './fakeMonitor';
import { addServer, setActiveServer, servers, removeServer } from '../../src/store/servers';
import { TorrServerClient } from '../../src/api/torrserver';
import { addFindings, addSubscription } from '../../src/monitor/subs';
import { saveMonitorSettings } from '../../src/monitor/settings';
import type { SourceResult } from '../../src/sources/types';

let el: HTMLElement;
let mon: FakeMonitor;

function row(t: string): SourceResult {
  return { Title: t, Categories: '', Size: '', CreateDate: '', Tracker: '', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 0, source: 'x' };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

async function mount() {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  await act(async () => render(<App />, el));
  await flush();
}

const newsTab = () => Array.from(el.querySelectorAll('.m-nav-item')).find((b) => (b.textContent || '').includes('Новое')) as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  for (const s of servers.value.slice()) removeServer(s.id);
  setActiveServer(addServer({ url: 'http://srv:8090' }).id);
  resetTo({ name: 'library' });
  toast.value = '';
  vi.spyOn(native, 'takePendingMagnet').mockResolvedValue(null);
  vi.spyOn(native, 'onMagnet').mockReturnValue(() => {});
  vi.spyOn(TorrServerClient.prototype, 'list').mockResolvedValue([]);
  mon = fakeMonitor();
});

afterEach(() => {
  act(() => render(null, el));
  mon.restore();
  vi.restoreAllMocks();
});

describe('monitoring in the app shell', () => {
  it('schedules the background check with the saved settings at start', async () => {
    saveMonitorSettings({ hours: 6, wifiOnly: false });
    await mount();
    expect(mon.schedule).toHaveBeenCalledWith({ enabled: true, hours: 6, wifiOnly: false });
  });

  it('the bell on «Новое» counts unseen findings and follows background runs', async () => {
    await mount();
    expect(newsTab().querySelector('.m-nav-badge')).toBeNull();
    const s = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    addFindings([
      { subId: s.id, key: 'a', at: 1, result: row('Дюна 1') },
      { subId: 'episodes', key: 'h:2:10', at: 2, result: row('Сериал'), episodes: { torrentHash: 'h', torrentTitle: 'Сериал', season: 2, haveTo: 8, to: 10 } },
    ]);
    const list = TorrServerClient.prototype.list as unknown as ReturnType<typeof vi.fn>;
    list.mockClear();
    act(() => mon.done({ at: 1, kind: 'check', found: 2, notified: 2, answered: 1, asked: 1, subs: 1, skipped: 0, feed: false }));
    await flush();
    expect(newsTab().querySelector('.m-nav-badge')!.textContent).toBe('2');
    expect(newsTab().getAttribute('aria-label')).toBe('Новое, 2 новых');
    // the library is reloaded too
    expect(list).toHaveBeenCalled();
  });

  it('a run that could not notify asks for the permission once', async () => {
    await mount();
    const blocked = { at: 1, kind: 'check' as const, found: 1, notified: 0, answered: 1, asked: 1, subs: 1, skipped: 0, feed: false, notifyBlocked: true };
    act(() => mon.done(blocked));
    await flush();
    expect(mon.requestNotifyPermission).toHaveBeenCalledTimes(1);
    act(() => mon.done(blocked));
    await flush();
    expect(mon.requestNotifyPermission).toHaveBeenCalledTimes(1);
  });

  it('a denied permission gets a single hint instead', async () => {
    mon.permission = 'denied';
    await mount();
    act(() => mon.done({ at: 1, kind: 'check', found: 1, notified: 0, answered: 1, asked: 1, subs: 1, skipped: 0, feed: false, notifyBlocked: true }));
    await flush();
    expect(mon.requestNotifyPermission).not.toHaveBeenCalled();
    expect(toast.value).toContain('Уведомления OMP выключены');
  });

  it('a tapped notification on cold start opens the findings of its subscription', async () => {
    const s = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    addFindings([{ subId: s.id, key: 'k1', at: 1, result: row('Дюна: Часть третья') }]);
    mon.openUrl = 'omp:news?sub=' + encodeURIComponent(s.id) + '&finding=k1&watch=1';
    await mount();
    expect(currentRoute.value).toEqual({ name: 'subFindings', id: s.id, finding: 'k1', watch: true });
    expect(routeStack.value.map((r) => r.name)).toEqual(['news', 'subFindings']);
    expect(el.querySelector('.m-watch-prompt')).toBeTruthy();
  });

  it('links while running: new episodes open «Новое» on the card; junk is ignored', async () => {
    await mount();
    act(() => mon.open('omp:news?sub=episodes&finding=' + encodeURIComponent('h:2:10')));
    await flush();
    expect(currentRoute.value).toEqual({ name: 'news', seg: 'subs', finding: 'h:2:10', watch: false });
    act(() => mon.open('omp:other?sub=x'));
    expect(currentRoute.value.name).toBe('news');
  });

  it('a link to a deleted subscription opens the subscriptions list', async () => {
    await mount();
    act(() => mon.open('omp:news?sub=gone&finding=k'));
    expect(currentRoute.value).toEqual({ name: 'news', seg: 'subs' });
  });

  it('without a server the link is ignored', async () => {
    for (const s of servers.value.slice()) removeServer(s.id);
    resetTo({ name: 'connect' });
    mon.openUrl = 'omp:news?sub=episodes&finding=k';
    await mount();
    expect(currentRoute.value.name).toBe('connect');
  });
});

describe('parseNewsLink', () => {
  it('reads sub, finding and watch', () => {
    expect(parseNewsLink('omp:news?sub=s1&finding=h%3Aabc%7Ct%3Ax&watch=1')).toEqual({ sub: 's1', finding: 'h:abc|t:x', watch: true });
    expect(parseNewsLink('omp:news?sub=episodes')).toEqual({ sub: 'episodes', watch: false });
    expect(parseNewsLink('omp:news?finding=x')).toBeNull();
    expect(parseNewsLink('https://example.com/?sub=1')).toBeNull();
  });
});

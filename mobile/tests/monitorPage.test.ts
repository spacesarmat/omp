import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyLanguageSetting } from '../../src/i18n';
import {
  runMonitor,
  runAction,
  subNotification,
  episodeNotification,
  betterNotification,
  EPISODE_CURSOR_KEY,
  BETTER_PER_RUN,
  BETTER_SHARE_MS,
  hostContext,
  type MonitorClient,
  type PageDeps,
} from '../src/monitor/page';
import type { MonitorAction, MonitorHost, MonitorNotification, StartInfo } from '../src/monitor/host';
import type { SearchFn } from '../../src/monitor/check';
import { addSubscription, addFindings, findingsOf, loadFound, seenKeys } from '../../src/monitor/subs';
import { resultKeys } from '../../src/monitor/match';
import { loadFeed } from '../../src/monitor/feedCache';
import { loadLastRun, saveMonitorSettings, type MonitorSummary } from '../../src/monitor/settings';
import { BETTER_ID, EPISODES_ID, type Finding } from '../../src/monitor/types';
import type { Torrent } from '../../src/api/types';
import type { Source, SourceResult } from '../../src/sources/types';
import type { NativeHttpRequest } from '../../src/sources/http';
import { mergeJournal, type JournalItem } from '../src/monitor/journal';
import { SEEN_KEY } from '../../src/monitor/subs';
import { torrentby } from '../../src/sources/torrentby';
import { pauseSource, PAUSE_MS } from '../../src/sources/ipBan';

function res(Title: string, extra?: Partial<SourceResult>): SourceResult {
  return { Title, Categories: '', Size: '41 ГБ', CreateDate: '', Tracker: 'rutor', Link: '', Magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), Hash: '', Peer: 0, Seed: 1200, source: 'rutor', ...extra };
}

interface FakeHost extends MonitorHost {
  notes: MonitorNotification[];
  persisted: JournalItem[];
  /** Order of persist / notify calls. */
  log: string[];
  shown: boolean;
  finished: MonitorSummary[];
  httpCalls: NativeHttpRequest[];
}

function fakeHost(info: Partial<StartInfo> = {}, startFails = false): FakeHost {
  const h: FakeHost = {
    notes: [],
    persisted: [],
    log: [],
    shown: true,
    finished: [],
    httpCalls: [],
    start: () => (startFails ? Promise.reject(new Error('Нет ответа от приложения')) : Promise.resolve({ action: null, deadline: Date.now() + 180_000, journal: [], ...info })),
    http: (req) => {
      h.httpCalls.push(req);
      return Promise.reject(new Error('no network in tests'));
    },
    secretGet: () => Promise.resolve({ value: null }),
    notify: (n) => {
      h.notes.push(n);
      h.log.push('notify');
      return Promise.resolve(h.shown);
    },
    persist: (items) => {
      h.persisted.push(...items);
      h.log.push('persist');
      return Promise.resolve();
    },
    finish: (s) => {
      h.finished.push(s);
    },
  };
  return h;
}

/** searchAll double: results per query, `rutor` answered. */
function fakeSearch(pages: { [query: string]: SourceResult[] }, queries: string[] = []): SearchFn {
  return (query) => {
    queries.push(query);
    return {
      sourceIds: ['rutor'],
      results: () => (pages[query] || []).slice(),
      pending: () => [],
      answered: () => ['rutor'],
      failed: () => [],
      done: Promise.resolve(),
      cancel: () => undefined,
    };
  };
}

function feedSource(calls: string[]): Source {
  return {
    id: 'rutor',
    name: 'rutor',
    kind: 'builtin',
    search: () => Promise.resolve([]),
    latest: (_ctx, cat) => {
      calls.push(cat);
      return Promise.resolve([res('Свежее ' + cat, { date: 5 }), res('Новее ' + cat, { date: 9, Magnet: 'magnet:?xt=urn:btih:' + 'b'.repeat(40) })]);
    },
  };
}

interface FakeClient extends MonitorClient {
  added: { link: string; category?: string }[];
}

function fakeClient(list: Torrent[] = [], fail?: boolean): FakeClient {
  const c: FakeClient = {
    added: [],
    list: () => (fail ? Promise.reject(Object.assign(new Error('x'), { kind: 'network' })) : Promise.resolve(list)),
    add: (p) => {
      c.added.push({ link: p.link, category: p.category });
      return fail ? Promise.reject(Object.assign(new Error('x'), { kind: 'network' })) : Promise.resolve({ hash: 'c'.repeat(40), title: 'x' } as Torrent);
    },
    search: () => Promise.resolve([]),
    loadInfo: () => Promise.reject(new Error('no')),
    remove: () => Promise.reject(new Error('no')),
    setData: () => Promise.reject(new Error('no')),
  } as FakeClient;
  return c;
}

const DUNE = 'Дюна: Часть третья (2026) WEB-DL 2160p HDR';
const SERIES = 'Starbound Frontier / Сезон: 1 / Серии: 1-8 из 10 [2026, WEB-DL 1080p]';
const NEWER = 'Starbound Frontier / Сезон: 1 / Серии: 1-10 из 10 [2026, WEB-DL 1080p]';

function deps(host: MonitorHost, extra: Partial<PageDeps> = {}): PageDeps {
  return { host, client: () => null, feed: { from: [] }, check: { search: fakeSearch({}) }, ...extra };
}

beforeEach(() => {
  localStorage.clear();
});

describe('notification texts', () => {
  it('a subscription: «Дюна 2160p: 2 новые раздачи» and the best release', () => {
    const sub = addSubscription({ query: 'Дюна', quality: '2160', sources: null, notify: true })!;
    const r = res(DUNE);
    const f = (key: string): Finding => ({ subId: sub.id, key, result: r, at: 1 });
    const n = subNotification(sub, [f('k1'), f('k2')]);
    expect(n).toEqual({
      channel: 'subs',
      id: 'sub:' + sub.id,
      subId: sub.id,
      key: 'k1',
      title: 'Дюна 2160p: 2 новые раздачи',
      text: DUNE + ' · 41 ГБ · 1200 сидов · rutor',
      action: 'add',
    });
    expect(subNotification({ ...sub, quality: '' }, [f('k')]).title).toBe('Дюна: 1 новая раздача');
    expect(subNotification(sub, [1, 2, 3, 4, 5].map((i) => f('k' + i))).title).toBe('Дюна 2160p: 5 новых раздач');
  });

  it('new episodes: «вышли серии 9–10» and «У вас 1–8»', () => {
    const f: Finding = {
      subId: EPISODES_ID,
      key: 'h:1:10',
      result: res(NEWER),
      at: 1,
      episodes: { torrentHash: 'f'.repeat(40), torrentTitle: SERIES, season: 1, haveTo: 8, from: 1, to: 10 },
    };
    expect(episodeNotification(f)).toEqual({
      channel: 'episodes',
      id: 'ep:' + 'f'.repeat(40),
      subId: EPISODES_ID,
      key: 'h:1:10',
      title: 'Starbound Frontier: вышли серии 9–10',
      text: 'Новая раздача на rutor: серии 1–10 из 10. У вас 1–8.',
      action: 'replace',
    });
    const one = { ...f, episodes: { ...f.episodes!, haveTo: 9 } };
    expect(episodeNotification(one).title).toBe('Starbound Frontier: вышла серия 10');
  });
});

describe('runMonitor: a check', () => {
  it('first run is silent; later new results are notified once and the summary is saved', async () => {
    const sub = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    const pages: { [q: string]: SourceResult[] } = { 'Дюна': [res('Дюна (2021) 1080p')] };
    const search = fakeSearch(pages);
    const host1 = fakeHost();
    await runMonitor(deps(host1, { check: { search } }));
    expect(host1.notes).toEqual([]);
    expect(seenKeys(sub.id)).not.toBeNull();
    expect(host1.finished).toHaveLength(1);

    pages['Дюна'] = [res('Дюна (2021) 1080p'), res(DUNE, { Magnet: 'magnet:?xt=urn:btih:' + 'd'.repeat(40) })];
    const host2 = fakeHost();
    const s = await runMonitor(deps(host2, { check: { search }, now: () => 5000 }));
    expect(host2.notes).toHaveLength(1);
    expect(host2.notes[0].title).toBe('Дюна: 1 новая раздача');
    expect(s).toMatchObject({ kind: 'check', found: 1, notified: 1, answered: 1, asked: 1, subs: 1, skipped: 0 });
    expect(host2.finished[0]).toEqual(s);
    expect(loadLastRun()).toEqual(s);
    expect(findingsOf(sub.id)).toHaveLength(1);

    const host3 = fakeHost();
    await runMonitor(deps(host3, { check: { search } }));
    expect(host3.notes).toEqual([]);
  });

  it('a subscription with «Уведомлять» off keeps its findings but shows nothing', async () => {
    const sub = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: false })!;
    const pages: { [q: string]: SourceResult[] } = { 'Дюна': [res('Дюна (2021) 1080p')] };
    await runMonitor(deps(fakeHost(), { check: { search: fakeSearch(pages) } }));
    pages['Дюна'] = pages['Дюна'].concat(res(DUNE, { Magnet: 'magnet:?xt=urn:btih:' + 'e'.repeat(40) }));
    const host = fakeHost();
    const s = await runMonitor(deps(host, { check: { search: fakeSearch(pages) } }));
    expect(host.notes).toEqual([]);
    expect(s.found).toBe(1);
    expect(findingsOf(sub.id)).toHaveLength(1);
  });

  it('skips the subscriptions when no time is left', async () => {
    addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true });
    const queries: string[] = [];
    const host = fakeHost({ deadline: Date.now() + 20_000 });
    const s = await runMonitor(deps(host, { check: { search: fakeSearch({}, queries) } }));
    expect(queries).toEqual([]);
    expect(s.skipped).toBe(1);
    expect(s.feed).toBe(false);
  });

  it('new episodes of the library series are notified; «Не следить» series are not searched', async () => {
    const watched = { hash: 'f'.repeat(40), title: SERIES, category: 'tv' } as Torrent;
    const off = { hash: 'e'.repeat(40), title: 'Other Show / Сезон: 1 / Серии: 1-3 из 10', category: 'tv', data: JSON.stringify({ omp: { w: false } }) } as Torrent;
    const film = { hash: 'd'.repeat(40), title: 'Дюна (2021) 1080p', category: 'movie' } as Torrent;
    const queries: string[] = [];
    const host = fakeHost();
    const client = fakeClient([watched, off, film]);
    const s = await runMonitor(deps(host, { client: () => client, check: { search: fakeSearch({ 'Starbound Frontier': [res(NEWER)] }, queries) } }));
    expect(queries).toEqual(['Starbound Frontier', 'Дюна 2021']);
    expect(host.notes.map((n) => n.title)).toEqual(['Starbound Frontier: вышли серии 9–10']);
    expect(s.found).toBe(1);
    expect(findingsOf(EPISODES_ID)).toHaveLength(1);
    expect(localStorage.getItem(EPISODE_CURSOR_KEY)).toBe('0');

    const again = fakeHost();
    await runMonitor(deps(again, { client: () => client, check: { search: fakeSearch({ 'Starbound Frontier': [res(NEWER)] }) } }));
    expect(again.notes).toEqual([]);
  });

  it('episode cards of torrents that are no longer in the library are dropped', async () => {
    const mk = (hash: string): Finding => ({
      subId: EPISODES_ID,
      key: hash + ':1:10',
      result: res(NEWER),
      at: 1,
      episodes: { torrentHash: hash, torrentTitle: SERIES, season: 1, haveTo: 8, to: 10 },
    });
    addFindings([mk('f'.repeat(40)), mk('9'.repeat(40))]);
    const client = fakeClient([{ hash: 'F'.repeat(40), title: 'Other', category: 'movie' } as Torrent]);
    await runMonitor(deps(fakeHost(), { client: () => client }));
    expect(findingsOf(EPISODES_ID).map((f) => f.episodes!.torrentHash)).toEqual(['f'.repeat(40)]);
  });

  it('a notification the bridge rejects is reported as not shown', async () => {
    const sub = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    await runMonitor(deps(fakeHost(), { check: { search: fakeSearch({ Дюна: [res(DUNE)] }) } }));
    const host = fakeHost();
    host.notify = () => Promise.reject(new Error('Неверный запрос'));
    const s = await runMonitor(deps(host, { check: { search: fakeSearch({ Дюна: [res(DUNE), res(DUNE + ' new', { Magnet: 'magnet:?xt=urn:btih:' + 'b'.repeat(40) })] }) } }));
    expect(s.found).toBe(1);
    expect(s.notified).toBe(0);
    expect(s.notifyBlocked).toBe(true);
    expect(findingsOf(sub.id)).toHaveLength(1);
  });

  it('new episodes and better quality both off: the library is not read', async () => {
    saveMonitorSettings({ episodes: false, better: false });
    let listed = false;
    const client = fakeClient();
    client.list = () => {
      listed = true;
      return Promise.resolve([]);
    };
    await runMonitor(deps(fakeHost(), { client: () => client }));
    expect(listed).toBe(false);
  });

  it('reports an unreachable server for the new episodes and still finishes', async () => {
    const host = fakeHost();
    const s = await runMonitor(deps(host, { client: () => fakeClient([], true) }));
    expect(s.error).toBe('Сервер недоступен');
    expect(host.finished).toHaveLength(1);
  });

  it('refreshes a stale «Новое» feed, newest first, and leaves a fresh one alone', async () => {
    const calls: string[] = [];
    const host = fakeHost();
    const s = await runMonitor(deps(host, { feed: { from: [feedSource(calls)] } }));
    expect(s.feed).toBe(true);
    expect(calls.sort()).toEqual(['anime', 'movie', 'tv']);
    expect(loadFeed('movie')!.results.map((r) => r.Title)).toEqual(['Новее movie', 'Свежее movie']);

    const calls2: string[] = [];
    const s2 = await runMonitor(deps(fakeHost(), { feed: { from: [feedSource(calls2)] } }));
    expect(calls2).toEqual([]);
    expect(s2.feed).toBe(false);
  });

  it('a failing start still finishes with the error', async () => {
    const host = fakeHost({}, true);
    const s = await runMonitor(deps(host));
    expect(s.error).toBe('Нет ответа от приложения');
    expect(host.finished).toEqual([s]);
  });
});

describe('notification texts in English', () => {
  afterEach(() => applyLanguageSetting('ru'));

  it('titles, texts and button results have no Russian', async () => {
    applyLanguageSetting('en');
    const sub = addSubscription({ query: 'Dune', quality: '2160', sources: null, notify: true })!;
    const r = res('Dune 2021 2160p');
    const f = (key: string): Finding => ({ subId: sub.id, key, result: r, at: 1 });
    expect(subNotification(sub, [f('k1'), f('k2')]).title).toBe('Dune 2160p: 2 new torrents');
    expect(subNotification(sub, [f('k1')]).title).toBe('Dune 2160p: 1 new torrent');
    const ep: Finding = {
      subId: EPISODES_ID,
      key: 'h:1:10',
      result: res('Starbound Frontier S01E01-10 of 10'),
      at: 1,
      episodes: { torrentHash: 'f'.repeat(40), torrentTitle: 'Starbound Frontier S01 1-8', season: 1, haveTo: 8, from: 1, to: 10 },
    };
    const n = episodeNotification(ep);
    expect(n.title).toBe('Starbound Frontier: episodes 9–10 are out');
    expect(n.text).toBe('New torrent on rutor: episodes 1–10 of 10. You have 1–8.');
    expect(n.title + n.text).not.toMatch(/[А-Яа-яЁё]/);
    // a button with no saved finding and no server
    const host = fakeHost({ action: { kind: 'add', subId: 'nope', key: 'nope' } });
    const s = await runMonitor(deps(host, { client: () => null }));
    expect(s.action!.message).toBe('The finding is no longer available — open OMP');
    expect(s.action!.message).not.toMatch(/[А-Яа-яЁё]/);
  });
});

describe('runMonitor: notification buttons', () => {
  function subFinding(): { sub: string; f: Finding } {
    const sub = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    const r = res(DUNE);
    const f: Finding = { subId: sub.id, key: resultKeys(r)[0], result: r, at: 1 };
    addFindings([f]);
    return { sub: sub.id, f };
  }

  it('«Добавить» adds the release to the server and marks the finding seen', async () => {
    const { sub, f } = subFinding();
    const client = fakeClient();
    const action: MonitorAction = { kind: 'add', subId: sub, key: f.key };
    let after = '';
    const host = fakeHost({ action });
    const s = await runMonitor(deps(host, { client: () => client, afterAdd: (_c, _t, title) => Promise.resolve((after = title)) }));
    expect(client.added).toEqual([{ link: f.result.Magnet, category: 'movie' }]);
    expect(s.kind).toBe('action');
    expect(s.action).toEqual({ ok: true, message: 'Добавлено на сервер', title: DUNE });
    expect(after).toBe(DUNE);
    expect(loadFound()[0].seen).toBe(true);
    expect(host.notes).toEqual([]);
    // a button run does not replace the last check's summary
    expect(loadLastRun()).toBeNull();
  });

  it('«Добавить» reports the server error', async () => {
    const { sub, f } = subFinding();
    const r = await runAction(deps(fakeHost(), { client: () => fakeClient([], true) }), { kind: 'add', subId: sub, key: f.key });
    expect(r).toEqual({ ok: false, message: 'Сервер недоступен', title: DUNE });
  });

  it('no server chosen / finding gone', async () => {
    const { sub, f } = subFinding();
    expect(await runAction(deps(fakeHost()), { kind: 'add', subId: sub, key: f.key })).toEqual({ ok: false, message: 'Сервер не выбран', title: DUNE });
    expect((await runAction(deps(fakeHost()), { kind: 'add', subId: sub, key: 'nope' })).ok).toBe(false);
    // «Заменить» needs a new-episodes finding
    expect((await runAction(deps(fakeHost(), { client: () => fakeClient() }), { kind: 'replace', subId: sub, key: f.key })).message).toMatch(/Находка/);
  });

  it('«Заменить» reports a failed replace and keeps the finding', async () => {
    const f: Finding = {
      subId: EPISODES_ID,
      key: 'f:1:10',
      result: res(NEWER),
      at: 1,
      episodes: { torrentHash: 'f'.repeat(40), torrentTitle: SERIES, season: 1, haveTo: 8, to: 10 },
    };
    addFindings([f]);
    const r = await runAction(deps(fakeHost(), { client: () => fakeClient([], true) }), { kind: 'replace', subId: EPISODES_ID, key: f.key });
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
    expect(findingsOf(EPISODES_ID)).toHaveLength(1);
  });
});

describe('durable dedup markers (journal)', () => {
  it('markers are stored before the notification; a lost localStorage write does not repeat it', async () => {
    const sub = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    const pages: { [q: string]: SourceResult[] } = { 'Дюна': [res('Дюна (2021) 1080p')] };
    await runMonitor(deps(fakeHost(), { check: { search: fakeSearch(pages) } }));
    const before = localStorage.getItem(SEEN_KEY)!;

    pages['Дюна'] = pages['Дюна'].concat(res(DUNE, { Magnet: 'magnet:?xt=urn:btih:' + 'd'.repeat(40) }));
    const host = fakeHost();
    await runMonitor(deps(host, { check: { search: fakeSearch(pages) } }));
    expect(host.notes).toHaveLength(1);
    expect(host.log).toEqual(['persist', 'notify']);
    expect(host.persisted).toEqual([{ s: sub.id, e: expect.stringContaining('t:дюна часть третья') }]);

    // the process died before Chromium wrote the seen keys: localStorage is back to the earlier state
    localStorage.setItem(SEEN_KEY, before);
    const again = fakeHost({ journal: host.persisted });
    await runMonitor(deps(again, { check: { search: fakeSearch(pages) } }));
    expect(again.notes).toEqual([]);
    // without the journal it would have been notified again
    localStorage.setItem(SEEN_KEY, before);
    const lost = fakeHost();
    await runMonitor(deps(lost, { check: { search: fakeSearch(pages) } }));
    expect(lost.notes).toHaveLength(1);
  });

  it('new-episode markers and button markers merge back; deleted or reset subscriptions are left alone', async () => {
    const { mergeJournal } = await import('../src/monitor/journal');
    const sub = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    const r = res(DUNE);
    addFindings([{ subId: sub.id, key: resultKeys(r)[0], result: r, at: 1 }]);
    expect(mergeJournal([{ s: sub.id, e: 'h:x' }, { s: 'gone', e: 'h:y' }])).toBe(0); // never checked: next check is silent anyway
    expect(mergeJournal([{ s: EPISODES_ID, e: 'f:1:10' }, { s: sub.id, k: resultKeys(r)[0], a: 'add' }])).toBe(1);
    expect(seenKeys(EPISODES_ID)).toEqual(['f:1:10']);
    expect(loadFound()[0].seen).toBe(true);
    expect(seenKeys('gone')).toBeNull();
    expect(mergeJournal([{ s: EPISODES_ID, e: 'f:1:10' }])).toBe(0);
  });

  it('a successful button leaves a marker; notifications Android could not show are reported', async () => {
    const sub = addSubscription({ query: 'Дюна', quality: '', sources: null, notify: true })!;
    const r = res(DUNE);
    const key = resultKeys(r)[0];
    addFindings([{ subId: sub.id, key, result: r, at: 1 }]);
    const host = fakeHost({ action: { kind: 'add', subId: sub.id, key } });
    await runMonitor(deps(host, { client: () => fakeClient() }));
    expect(host.persisted).toEqual([{ s: sub.id, k: key, a: 'add' }]);

    const pages: { [q: string]: SourceResult[] } = { 'Дюна': [res('Дюна (2021) 1080p')] };
    await runMonitor(deps(fakeHost(), { check: { search: fakeSearch(pages) } }));
    pages['Дюна'] = pages['Дюна'].concat(res('Дюна 2', { Magnet: 'magnet:?xt=urn:btih:' + '9'.repeat(40) }));
    const blocked = fakeHost();
    blocked.shown = false;
    const s = await runMonitor(deps(blocked, { check: { search: fakeSearch(pages) } }));
    expect(s.found).toBe(1);
    expect(s.notified).toBe(0);
    expect(s.notifyBlocked).toBe(true);
  });
});

describe('«Лучшее качество» in the background', () => {
  const FILM = 'Северный ветер (2026) WEB-DL 1080p';
  const UHD = 'Северный ветер (2026) 2160p WEB-DL';
  const film = { hash: 'd'.repeat(40), title: FILM, category: 'movie' } as Torrent;

  it('an upgrade with films in the library: the first run notifies nothing and keeps the other cards', async () => {
    const names = ['Северный ветер', 'Тихая гавань', 'Ночной рейс', 'Белый город'];
    const films = names.map((n, i) => ({ hash: String(i).repeat(40), title: n + ' (2026) WEB-DL 1080p', category: 'movie' }) as Torrent);
    const pages: { [q: string]: SourceResult[] } = {};
    names.forEach((n) => (pages[n + ' 2026'] = [res(n + ' (2026) 2160p Remux')]));
    const host = fakeHost();
    const s = await runMonitor(deps(host, { client: () => fakeClient(films), check: { search: fakeSearch(pages) }, now: () => 1_000_000 }));
    expect(host.notes).toEqual([]);
    expect(s.found).toBe(0);
    expect(findingsOf(BETTER_ID)).toEqual([]);
    expect(seenKeys(BETTER_ID)).toHaveLength(names.length);
  });

  it('the films are checked after the episodes, once a day, on the «better» channel', async () => {
    // checked before (the baseline is done), nothing reported yet
    localStorage.setItem('tsp.betterChecked', JSON.stringify({ ['d'.repeat(40)]: 1 }));
    const queries: string[] = [];
    const client = fakeClient([film]);
    const search = fakeSearch({ 'Северный ветер 2026': [res(UHD)] }, queries);
    const host = fakeHost();
    const s = await runMonitor(deps(host, { client: () => client, check: { search }, now: () => 100_000_000 }));
    expect(queries).toEqual(['Северный ветер 2026']);
    expect(host.notes).toEqual([
      {
        channel: 'better',
        id: 'better:' + 'd'.repeat(40),
        subId: BETTER_ID,
        key: 'd'.repeat(40) + ':32',
        title: 'Вышло в лучшем качестве',
        text: 'Северный ветер · 4K WEB-DL · у вас 1080p WEB-DL',
        action: 'replace',
      },
    ]);
    expect(host.log).toEqual(['persist', 'notify']);
    expect(host.persisted).toEqual([{ s: BETTER_ID, e: 'd'.repeat(40) + ':32' }]);
    expect(s.found).toBe(1);
    // an hour later the film is not searched again
    await runMonitor(deps(fakeHost(), { client: () => client, check: { search }, now: () => 100_000_000 + 3_600_000 }));
    expect(queries).toHaveLength(1);
  });

  it('«Лучшее качество фильмов» off: no film is searched; with the episodes off alone the films still are', async () => {
    saveMonitorSettings({ better: false });
    const queries: string[] = [];
    const client = fakeClient([film]);
    await runMonitor(deps(fakeHost(), { client: () => client, check: { search: fakeSearch({}, queries) } }));
    expect(queries).toEqual([]);
    saveMonitorSettings({ better: true, episodes: false });
    await runMonitor(deps(fakeHost(), { client: () => client, check: { search: fakeSearch({}, queries) } }));
    expect(queries).toEqual(['Северный ветер 2026']);
  });

  it('«Заменить» on a film notification runs the replace and keeps the card when it fails', async () => {
    const f: Finding = {
      subId: BETTER_ID,
      key: 'd'.repeat(40) + ':32',
      result: res(UHD),
      at: 1,
      better: { torrentHash: 'd'.repeat(40), torrentTitle: FILM, have: '1080p WEB-DL', got: '4K WEB-DL' },
    };
    addFindings([f]);
    const r = await runAction(deps(fakeHost(), { client: () => fakeClient([], true) }), { kind: 'replace', subId: BETTER_ID, key: f.key });
    expect(r.ok).toBe(false);
    expect(r.message).not.toBe('Находка больше не доступна — откройте OMP');
    expect(findingsOf(BETTER_ID)).toHaveLength(1);
  });

  it('better-quality markers merge back like the new-episode ones', () => {
    expect(mergeJournal([{ s: BETTER_ID, e: 'd'.repeat(40) + ':32' }])).toBe(1);
    expect(seenKeys(BETTER_ID)).toEqual(['d'.repeat(40) + ':32']);
  });

  it('the notification in English', () => {
    applyLanguageSetting('en');
    try {
      const n = betterNotification({
        subId: BETTER_ID,
        key: 'h:32',
        result: res('North Wind (2026) 2160p WEB-DL'),
        at: 1,
        better: { torrentHash: 'h', torrentTitle: 'North Wind (2026) WEB-DL 1080p', have: '', got: '4K WEB-DL' },
      });
      expect(n.title).toBe('Out in better quality');
      expect(n.text).toBe('North Wind · 4K WEB-DL · you have unknown quality');
      expect(n.title + n.text).not.toMatch(/[А-Яа-яЁё]/);
    } finally {
      applyLanguageSetting('ru');
    }
  });
});

describe('the background load of the film checks', () => {
  const NAMES = ['Северный ветер', 'Тихая гавань', 'Ночной рейс', 'Белый город', 'Последний мост', 'Долгая зима', 'Синяя птица', 'Старый маяк'];
  const films = NAMES.map((n, i) => ({ hash: String(i).repeat(40), title: n + ' (2026) WEB-DL 1080p', category: 'movie' }) as Torrent);
  const filmQueries = (q: string[]) => q.filter((x) => / 2026$/.test(x)).map((x) => NAMES.indexOf(x.replace(/ 2026$/, '')));

  /** searchAll double that takes `ms` of the page clock per search. */
  function slowSearch(clock: { now: number }, ms: number, queries: string[]): SearchFn {
    const inner = fakeSearch({}, queries);
    return (query, opts) => {
      clock.now += ms;
      return inner(query, opts);
    };
  }

  it('at most BETTER_PER_RUN films per run, the never checked and then the longest unchecked first', async () => {
    expect(BETTER_PER_RUN).toBe(5);
    const T = 10 * 24 * 3_600_000;
    const q: string[] = [];
    const client = fakeClient(films);
    const run = (now: number) => runMonitor(deps(fakeHost(), { client: () => client, check: { search: fakeSearch({}, q) }, now: () => now }));
    await run(T);
    expect(filmQueries(q)).toEqual([0, 1, 2, 3, 4]);
    q.length = 0;
    // the next run goes on with the films never checked
    await run(T + 3_600_000);
    expect(filmQueries(q)).toEqual([5, 6, 7]);
    q.length = 0;
    // a day later every film is due again: the longest unchecked first
    await run(T + 24 * 3_600_000 + 2 * 3_600_000);
    expect(filmQueries(q)).toEqual([0, 1, 2, 3, 4]);
    q.length = 0;
    await run(T + 24 * 3_600_000 + 3 * 3_600_000);
    expect(filmQueries(q)).toEqual([5, 6, 7]);
  });

  it('the films keep to their share: the «Новое» feed still runs and the films stop within BETTER_SHARE_MS', async () => {
    expect(BETTER_SHARE_MS).toBe(45_000);
    const clock = { now: 1_000_000 };
    const q: string[] = [];
    const calls: string[] = [];
    const host = fakeHost({ deadline: clock.now + 180_000 });
    const s = await runMonitor(
      deps(host, { client: () => fakeClient(films), check: { search: slowSearch(clock, 20_000, q) }, feed: { from: [feedSource(calls)] }, now: () => clock.now }),
    );
    expect(s.feed).toBe(true);
    expect(calls.sort()).toEqual(['anime', 'movie', 'tv']);
    // started at 0, 20 and 40 s of the share; the fourth would start at 60 s
    expect(filmQueries(q)).toEqual([0, 1, 2]);
  });

  it('a backlog of series leaves the films their share and the feed its turn', async () => {
    const clock = { now: 1_000_000 };
    const q: string[] = [];
    const calls: string[] = [];
    const series: Torrent[] = [];
    for (let i = 0; i < 12; i++)
      series.push({ hash: String.fromCharCode(97 + i).repeat(40), title: 'Сериал ' + 'абвгдежзиклм'[i] + ' / Сезон: 1 / Серии: 1-8 из 10 [2026]', category: 'tv' } as Torrent);
    const host = fakeHost({ deadline: clock.now + 180_000 });
    const s = await runMonitor(
      deps(host, {
        client: () => fakeClient(series.concat(films)),
        check: { search: slowSearch(clock, 20_000, q) },
        feed: { from: [feedSource(calls)] },
        now: () => clock.now,
      }),
    );
    expect(q.filter((x) => x.indexOf('Сериал') === 0).length).toBeGreaterThan(0);
    expect(filmQueries(q).length).toBeGreaterThan(0);
    expect(s.feed).toBe(true);
  });

  it('a paused torrent.by is not asked by the film checks', async () => {
    pauseSource('torrentby');
    const host = fakeHost();
    await runMonitor(deps(host, { client: () => fakeClient(films.slice(0, 2)), feed: { from: [] }, check: { from: [torrentby] } }));
    expect(host.httpCalls.filter((r) => r.url.indexOf('https://torrent.by/') === 0)).toEqual([]);
  });
});

describe('a site whose code page paused its background requests', () => {
  it('the background context says so; a paused torrent.by is not asked by the feed or a subscription', async () => {
    expect(hostContext(fakeHost(), null).background).toBe(true);
    addSubscription({ query: 'Starbound', quality: '', sources: null, notify: true });
    pauseSource('torrentby');
    const host = fakeHost();
    await runMonitor(deps(host, { feed: { from: [torrentby] }, check: { from: [torrentby] } }));
    expect(host.httpCalls.filter((r) => r.url.indexOf('https://torrent.by/') === 0)).toEqual([]);
  });

  it('after the hour the background asks it again (both sections of a category)', async () => {
    pauseSource('torrentby', Date.now() - PAUSE_MS - 1);
    const host = fakeHost();
    await runMonitor(deps(host, { feed: { from: [torrentby] } }));
    expect(host.httpCalls.map((r) => r.url).sort()).toEqual([
      'https://torrent.by/anime/',
      'https://torrent.by/films/',
      'https://torrent.by/movies/',
      'https://torrent.by/serials/',
      'https://torrent.by/series/',
    ]);
  });
});

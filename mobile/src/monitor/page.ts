// The background check (mobile/monitor.html), run by Android's WorkManager in a hidden WebView on the app's own
// origin, so it reads the same localStorage (subscriptions, findings, servers, settings) as the app.
// A check: subscriptions → new episodes of the library series → the «Новое» feed, each only while time is left.
// A notification button: «Добавить» a subscription finding / «Заменить» a series torrent.
import { errorMessage } from '../../../src/api/http';
import type { Torrent } from '../../../src/api/types';
import { guessCategory } from '../../../src/lib/categoryGuess';
import { checkSubscription, type CheckOptions } from '../../../src/monitor/check';
import { parseEpisodeRange } from '../../../src/monitor/episodes';
import { feedFresh, saveFeed } from '../../../src/monitor/feedCache';
import { checkNewEpisodes, isWatchedSeries, seriesQuery, type LibraryTorrent } from '../../../src/monitor/newEpisodes';
import { replaceWithResult, type ReplaceClient } from '../../../src/monitor/replace';
import { loadMonitorSettings, saveLastRun, type MonitorActionResult, type MonitorSummary } from '../../../src/monitor/settings';
import { loadFound, loadSubs, markFindingsSeen, removeFindings } from '../../../src/monitor/subs';
import { EPISODES_ID, type Finding, type Subscription } from '../../../src/monitor/types';
import { feedAll, type FeedAllOptions } from '../../../src/sources/feed';
import { createSecretStore, createSourceHttp } from '../../../src/sources/http';
import { FEED_CATEGORIES, type SourceContext } from '../../../src/sources/types';
import { resolveLink, seedsText, sortResults, sourceName } from '../../../src/sources/view';
import { loadJson, saveJson } from '../../../src/store/storage';
import type { MonitorAction, MonitorHost, MonitorNotification } from './host';

/** The TorrServer calls the page needs (TorrServerClient fits). */
export interface MonitorClient extends ReplaceClient {
  list(): Promise<Torrent[]>;
  add(p: { link: string; title?: string; poster?: string; category?: string }): Promise<Torrent>;
  /** The TorrServer search sources (rutor, Torznab). */
  search: NonNullable<SourceContext['client']>['search'];
}

export interface PageDeps {
  host: MonitorHost;
  /** The active server's client; null when none is chosen. */
  client: () => MonitorClient | null;
  /** Called after a torrent is added (poster lookup); optional. */
  afterAdd?: (c: MonitorClient, t: Torrent, title: string) => Promise<unknown>;
  /** Test doubles for the search / feed sources. */
  check?: CheckOptions;
  feed?: FeedAllOptions;
  now?: () => number;
}

/** Margins before Android's deadline: no new step starts later than this. */
export const SUB_MARGIN_MS = 30_000;
export const EPISODE_MARGIN_MS = 35_000;
export const FEED_MARGIN_MS = 25_000;
/** The run is wrapped up this long before the deadline. */
export const FINISH_MARGIN_MS = 8_000;
const AFTER_ADD_MS = 15_000;
/** Next library series to check: big libraries are covered over several runs. */
export const EPISODE_CURSOR_KEY = 'tsp.monitorEpisodeCursor';

const NO_SERVER = 'Сервер не выбран';
const GONE = 'Находка больше не доступна — откройте OMP';

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «Дюна 2160p: 2 новые раздачи» / «Дюна 2160p · 2 новые раздачи» as in the mockup. */
export function subNotification(sub: Subscription, found: Finding[]): MonitorNotification {
  const n = found.length;
  const top = found[0];
  const r = top.result;
  const q = sub.quality ? ' ' + sub.quality + 'p' : '';
  const parts = [r.Title];
  if (r.Size) parts.push(r.Size);
  if (r.Seed > 0) parts.push(seedsText(r.Seed));
  parts.push(sourceName(r.source));
  return {
    channel: 'subs',
    id: 'sub:' + sub.id,
    subId: sub.id,
    key: top.key,
    title: sub.query + q + ': ' + n + ' ' + plural(n, 'новая раздача', 'новые раздачи', 'новых раздач'),
    text: parts.join(' · '),
    action: 'add',
  };
}

function range(from: number, to: number): string {
  return from >= to ? String(to) : from + '–' + to;
}

/** «Starbound Frontier: вышли серии 9–10» / «Новая раздача на rutor: серии 1–10 из 10. У вас 1–8.» */
export function episodeNotification(f: Finding): MonitorNotification {
  const e = f.episodes!;
  const name = seriesQuery(e.torrentTitle) || e.torrentTitle;
  const first = e.haveTo + 1;
  const title = first >= e.to ? name + ': вышла серия ' + e.to : name + ': вышли серии ' + first + '–' + e.to;
  const total = parseEpisodeRange(f.result.Title).total;
  const all = range(e.from !== undefined ? e.from : 1, e.to) + (total ? ' из ' + total : '');
  const text = 'Новая раздача на ' + sourceName(f.result.source) + ': ' + (e.from !== undefined && e.from >= e.to ? 'серия ' : 'серии ') + all +
    '. У вас ' + range(1, e.haveTo) + '.';
  return { channel: 'episodes', id: 'ep:' + e.torrentHash, subId: EPISODES_ID, key: f.key, title, text, action: 'replace' };
}

/** SourceHttp / secrets over the host; the page never writes secrets. */
export function hostContext(host: MonitorHost, client: MonitorClient | null): SourceContext {
  const readOnly = () => Promise.reject(new Error('Недоступно в фоне'));
  return {
    http: createSourceHttp((req) => host.http(req)),
    client,
    secrets: createSecretStore({ get: (key) => host.secretGet(key), set: readOnly, delete: readOnly }),
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(undefined);
      },
    );
  });
}

function emptySummary(at: number, kind: MonitorSummary['kind']): MonitorSummary {
  return { at, kind, found: 0, notified: 0, answered: 0, asked: 0, subs: 0, skipped: 0, feed: false };
}

/** Runs one notification button; never rejects. */
export async function runAction(deps: PageDeps, a: MonitorAction): Promise<MonitorActionResult> {
  const f = loadFound().filter((x) => x.subId === a.subId && x.key === a.key)[0];
  if (!f || (a.kind === 'replace' && !f.episodes)) return { ok: false, message: GONE };
  const title = f.result.Title;
  const c = deps.client();
  if (!c) return { ok: false, message: NO_SERVER, title };
  const ctx = hostContext(deps.host, c);
  if (a.kind === 'replace') {
    const r = await replaceWithResult(c, f.episodes!.torrentHash, f.result, ctx);
    if (!r.ok) return { ok: false, message: r.error, title };
    removeFindings(EPISODES_ID, f.key);
    return { ok: true, message: 'Заменено', title };
  }
  try {
    const link = await resolveLink(f.result, ctx);
    const added = await c.add({ link, category: guessCategory(title) });
    markFindingsSeen(f.subId, [f.key]);
    if (deps.afterAdd) await withTimeout(deps.afterAdd(c, added, title), AFTER_ADD_MS);
    return { ok: true, message: 'Добавлено на сервер', title };
  } catch (e) {
    return { ok: false, message: errorMessage(e), title };
  }
}

function cursor(): number {
  const v = loadJson<number>(EPISODE_CURSOR_KEY, 0, (x) => typeof x === 'number' && x >= 0);
  return Math.floor(v);
}

/** A scheduled / «Проверить сейчас» check; never rejects. */
export async function runCheck(deps: PageDeps, deadline: number): Promise<MonitorSummary> {
  const now = deps.now || Date.now;
  const left = () => deadline - now();
  const s = emptySummary(now(), 'check');
  const settings = loadMonitorSettings();
  const c = deps.client();
  const ctx = hostContext(deps.host, c);
  const notify = (n: MonitorNotification) =>
    deps.host.notify(n).then(
      () => {
        s.notified++;
      },
      () => {},
    );

  // subscriptions, two at a time
  const subs = loadSubs();
  const answered: { [id: string]: boolean } = {};
  const asked: { [id: string]: boolean } = {};
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < subs.length) {
      const sub = subs[next++];
      if (left() < SUB_MARGIN_MS) {
        s.skipped++;
        continue;
      }
      const r = await checkSubscription(ctx, sub, deps.check);
      s.subs++;
      r.answered.forEach((id) => (answered[id] = asked[id] = true));
      r.failed.forEach((id) => (asked[id] = true));
      if (!r.findings.length) continue;
      s.found += r.findings.length;
      if (sub.notify) await notify(subNotification(sub, r.findings));
    }
  };
  await Promise.all([worker(), worker()]);
  s.answered = Object.keys(answered).length;
  s.asked = Object.keys(asked).length;

  // new episodes of the library series, one series at a time
  if (settings.episodes && left() >= EPISODE_MARGIN_MS) {
    if (!c) s.error = NO_SERVER;
    else {
      let list: Torrent[] | null = null;
      try {
        list = await c.list();
      } catch (e) {
        s.error = errorMessage(e);
      }
      const watched = (list || []).filter((t) => isWatchedSeries(t as LibraryTorrent));
      const start = watched.length ? cursor() % watched.length : 0;
      let done = 0;
      for (; done < watched.length && left() >= EPISODE_MARGIN_MS; done++) {
        const t = watched[(start + done) % watched.length];
        const found = await checkNewEpisodes(ctx, [t], deps.check);
        for (const f of found) {
          s.found++;
          await notify(episodeNotification(f));
        }
      }
      if (watched.length) saveJson(EPISODE_CURSOR_KEY, (start + done) % watched.length);
    }
  }

  // the «Новое» feed, categories in parallel, when it is stale
  if (left() >= FEED_MARGIN_MS) {
    const stale = FEED_CATEGORIES.filter((cat) => !feedFresh(cat, now()));
    const refreshed = await Promise.all(
      stale.map((cat) => {
        const h = feedAll(ctx, cat, deps.feed);
        return h.done.then(
          () => {
            if (!h.answered().length) return false;
            saveFeed(cat, sortResults(h.results(), 'date'), now());
            return true;
          },
          () => false,
        );
      }),
    );
    s.feed = refreshed.some((x) => x);
  }
  return s;
}

/** The whole run: asks Android what to do, does it, reports. Never rejects; finish() is always called. */
export async function runMonitor(deps: PageDeps): Promise<MonitorSummary> {
  const now = deps.now || Date.now;
  let summary: MonitorSummary;
  try {
    const info = await deps.host.start();
    if (info.action) {
      summary = emptySummary(now(), 'action');
      summary.action = await runAction(deps, info.action);
    } else {
      summary = await runCheck(deps, info.deadline - FINISH_MARGIN_MS);
      saveLastRun(summary);
    }
  } catch (e) {
    summary = emptySummary(now(), 'check');
    summary.error = errorMessage(e);
  }
  deps.host.finish(summary);
  return summary;
}

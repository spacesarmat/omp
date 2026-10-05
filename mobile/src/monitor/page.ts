// The background check (mobile/monitor.html), run by Android's WorkManager in a hidden WebView on the app's own
// origin, so it reads the same localStorage (subscriptions, findings, servers, settings) as the app.
// A check, each step only while time is left (the budget is RUN_LIMIT_MS on Android, about 3 minutes):
//   1. subscriptions, two at a time, until SUB_MARGIN_MS before the deadline;
//   2. new episodes of the library series, until EPISODE_MARGIN_MS plus the films' share (BETTER_SHARE_MS, only when
//      some film is due) before the deadline;
//   3. the «Новое» feed when stale (cheap: feedFresh), when FEED_MARGIN_MS are left;
//   4. better releases of the library films last: at most BETTER_PER_RUN films, the never checked and then the longest
//      unchecked first, each started within BETTER_SHARE_MS of the first and BETTER_MARGIN_MS before the deadline.
// So the films never take the turn of the subscriptions, the series or the feed, and a big library is covered over
// several runs (each film at most once a day, tsp.betterChecked). Sites paused by their code page (tsp.sourcePause)
// are not asked from here (hostContext: background).
// A notification button: «Добавить» a subscription finding / «Заменить» a series or film torrent.
import { errorMessage } from '../../../src/api/http';
import { t, tp } from '../../../src/i18n';
import type { Torrent } from '../../../src/api/types';
import { log, flushLog } from '../../../src/lib/log';
import { guessCategory } from '../../../src/lib/categoryGuess';
import { posterQuery } from '../../../src/lib/posterSearch';
import { checkBetterQuality, dueFilms, pruneBetterChecked } from '../../../src/monitor/better';
import { checkSubscription, type CheckOptions } from '../../../src/monitor/check';
import { parseEpisodeRange } from '../../../src/monitor/episodes';
import { feedFresh, storeFeedRefresh } from '../../../src/monitor/feedCache';
import { checkNewEpisodes, isWatchedSeries, seriesQuery, type LibraryTorrent } from '../../../src/monitor/newEpisodes';
import { replaceWithResult, type ReplaceClient } from '../../../src/monitor/replace';
import { loadMonitorSettings, saveLastRun, type MonitorActionResult, type MonitorSummary } from '../../../src/monitor/settings';
import { loadFound, loadSubs, markFindingsSeen, pruneEpisodeFindings, removeFindings } from '../../../src/monitor/subs';
import { BETTER_ID, EPISODES_ID, type Finding, type Subscription } from '../../../src/monitor/types';
import { feedAll, type FeedAllOptions } from '../../../src/sources/feed';
import { SOURCE_TIMEOUT_MS } from '../../../src/sources/search';
import { createSecretStore, createSourceHttp } from '../../../src/sources/http';
import { FEED_CATEGORIES, type SourceContext } from '../../../src/sources/types';
import { resolveLink, seedsText, sourceName } from '../../../src/sources/view';
import { loadJson, saveJson } from '../../../src/store/storage';
import type { MonitorAction, MonitorHost, MonitorNotification } from './host';
import { mergeJournal, type JournalItem } from './journal';
import { seenEntry } from '../../../src/monitor/match';
import { qualityText } from './text';

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
/** No film check starts later than this before the deadline: one search (SOURCE_TIMEOUT_MS) plus slack. */
export const BETTER_MARGIN_MS = SOURCE_TIMEOUT_MS + 5_000;
/** Films checked per run at most. */
export const BETTER_PER_RUN = 5;
/** The films' share of a run: no film check starts later than this after the first one; kept free by the series. */
export const BETTER_SHARE_MS = 45_000;
const AFTER_ADD_MS = 15_000;
/** Next library series to check: big libraries are covered over several runs. */
export const EPISODE_CURSOR_KEY = 'tsp.monitorEpisodeCursor';

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
    title: sub.query + q + ': ' + tp('notify.newTorrents', n),
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
  const title = first >= e.to ? t('notify.episodeTitle', { name: name, to: e.to }) : t('notify.episodesTitle', { name: name, from: first, to: e.to });
  const total = parseEpisodeRange(f.result.Title).total;
  const rng = range(e.from !== undefined ? e.from : 1, e.to);
  const all = total ? t('notify.rangeOfTotal', { range: rng, total: total }) : rng;
  const text = t(e.from !== undefined && e.from >= e.to ? 'notify.newReleaseEpisode' : 'notify.newReleaseEpisodes', {
    source: sourceName(f.result.source),
    all: all,
    have: range(1, e.haveTo),
  });
  return { channel: 'episodes', id: 'ep:' + e.torrentHash, subId: EPISODES_ID, key: f.key, title, text, action: 'replace' };
}

/** «Вышло в лучшем качестве» / «Северный ветер · 4K WEB-DL · у вас 1080p WEB-DL». */
export function betterNotification(f: Finding): MonitorNotification {
  const b = f.better!;
  const name = posterQuery(b.torrentTitle) || b.torrentTitle;
  return {
    channel: 'better',
    id: 'better:' + b.torrentHash,
    subId: BETTER_ID,
    key: f.key,
    title: t('notify.betterTitle'),
    text: t('notify.betterText', { name, got: qualityText(b.got), have: qualityText(b.have) }),
    action: 'replace',
  };
}

/** SourceHttp / secrets over the host; the page never writes secrets. */
export function hostContext(host: MonitorHost, client: MonitorClient | null): SourceContext {
  const readOnly = () => Promise.reject(new Error(t('notify.readOnly')));
  return {
    http: createSourceHttp((req) => host.http(req)),
    client,
    secrets: createSecretStore({ get: (key) => host.secretGet(key), set: readOnly, delete: readOnly }),
    // a site whose code page paused its background requests (tsp.sourcePause) is not asked from here
    background: true,
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
  // the library torrent «Заменить» replaces: a series with new episodes or a film in better quality
  const libHash = f ? (f.episodes ? f.episodes.torrentHash : f.better ? f.better.torrentHash : '') : '';
  if (!f || (a.kind === 'replace' && !libHash)) return { ok: false, message: t('notify.gone') };
  const title = f.result.Title;
  const c = deps.client();
  if (!c) return { ok: false, message: t('errors.noServerSelected'), title };
  const ctx = hostContext(deps.host, c);
  if (a.kind === 'replace') {
    const r = await replaceWithResult(c, libHash, f.result, ctx);
    if (!r.ok) return { ok: false, message: r.error, title };
    removeFindings(f.subId, f.key);
    await persist(deps, [{ s: f.subId, k: f.key, a: 'replace' }]);
    return { ok: true, message: t('notify.replaced'), title };
  }
  try {
    const link = await resolveLink(f.result, ctx);
    const added = await c.add({ link, title, category: guessCategory(title) });
    markFindingsSeen(f.subId, [f.key]);
    await persist(deps, [{ s: f.subId, k: f.key, a: 'add' }]);
    if (deps.afterAdd) await withTimeout(deps.afterAdd(c, added, title), AFTER_ADD_MS);
    return { ok: true, message: t('notify.added'), title };
  } catch (e) {
    return { ok: false, message: errorMessage(e), title };
  }
}

/** Dedup markers to Android before anything is shown; a failure only loses the extra safety. */
function persist(deps: PageDeps, items: JournalItem[]): Promise<void> {
  return items.length ? deps.host.persist(items).catch(() => undefined) : Promise.resolve();
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
      (shown) => {
        if (shown) s.notified++;
        else s.notifyBlocked = true;
      },
      () => {
        // a rejected notification (the bridge refused it) is not silent: the summary says it was not shown
        s.notifyBlocked = true;
      },
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
      await persist(deps, r.findings.map((f) => ({ s: sub.id, e: seenEntry(f.result) })));
      if (sub.notify) await notify(subNotification(sub, r.findings));
    }
  };
  await Promise.all([worker(), worker()]);
  s.answered = Object.keys(answered).length;
  s.asked = Object.keys(asked).length;

  // the library: new episodes of the series, one torrent at a time
  let films: LibraryTorrent[] = [];
  if ((settings.episodes || settings.better) && left() >= EPISODE_MARGIN_MS) {
    if (!c) s.error = t('errors.noServerSelected');
    else {
      let list: Torrent[] | null = null;
      try {
        list = await c.list();
      } catch (e) {
        s.error = errorMessage(e);
      }
      if (list) {
        const have: { [hash: string]: boolean } = {};
        list.forEach((t) => (have[(t.hash || '').toLowerCase()] = true));
        // cards of torrents deleted from the server can no longer be replaced or switched off
        pruneEpisodeFindings((h) => have[(h || '').toLowerCase()] === true);
        pruneBetterChecked((h) => have[h] === true);
        // the films not searched for the longest come first; each one at most once a day (tsp.betterChecked)
        if (settings.better) films = dueFilms(list as LibraryTorrent[], now()).slice(0, BETTER_PER_RUN);
      }
      if (settings.episodes) {
        // the films' share is kept free when some film is due
        const margin = EPISODE_MARGIN_MS + (films.length ? BETTER_SHARE_MS : 0);
        const watched = (list || []).filter((t) => isWatchedSeries(t as LibraryTorrent));
        const start = watched.length ? cursor() % watched.length : 0;
        let done = 0;
        for (; done < watched.length && left() >= margin; done++) {
          const t = watched[(start + done) % watched.length];
          const found = await checkNewEpisodes(ctx, [t], deps.check);
          for (const f of found) {
            s.found++;
            await persist(deps, [{ s: EPISODES_ID, e: f.key }]);
            await notify(episodeNotification(f));
          }
        }
        if (watched.length) saveJson(EPISODE_CURSOR_KEY, (start + done) % watched.length);
      }
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
            return storeFeedRefresh(cat, h.results(), h.answered(), now()) !== null;
          },
          () => false,
        );
      }),
    );
    s.feed = refreshed.some((x) => x);
  }

  // better releases of the films, last and within their share
  const filmsFrom = now();
  for (const film of films) {
    if (left() < BETTER_MARGIN_MS || now() - filmsFrom >= BETTER_SHARE_MS) break;
    const found = await checkBetterQuality(ctx, [film], { ...deps.check, now: now() });
    for (const f of found) {
      s.found++;
      await persist(deps, [{ s: BETTER_ID, e: f.key }]);
      await notify(betterNotification(f));
    }
  }
  return s;
}

/** Counts only, never titles. */
function logSummary(s: MonitorSummary): void {
  try {
    if (s.kind === 'action') {
      // the message is generic text; the release title is never logged
      if (s.action && !s.action.ok) log('error', 'monitor', t('notify.logActionFailed', { message: s.action.message }));
      else log('info', 'monitor', t('notify.logActionDone'));
    } else
      log(
        s.error ? 'error' : 'info',
        'monitor',
        t('notify.logRun', { subs: s.subs, found: s.found, answered: s.answered, asked: s.asked }) +
          (s.skipped ? t('notify.logSkipped', { n: s.skipped }) : '') +
          (s.error ? t('notify.logError', { error: s.error }) : ''),
      );
    flushLog();
  } catch {
    /* never break the run */
  }
}

/** The whole run: asks Android what to do, does it, reports. Never rejects; finish() is always called. */
export async function runMonitor(deps: PageDeps): Promise<MonitorSummary> {
  const now = deps.now || Date.now;
  let summary: MonitorSummary;
  try {
    const info = await deps.host.start();
    // seen keys a killed process may have lost from localStorage
    mergeJournal(info.journal);
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
  logSummary(summary);
  deps.host.finish(summary);
  return summary;
}

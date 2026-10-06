// «Новое» → «Календарь»: the episodes of the coming 30 days (and the last 3 days, «вышла») of the series the person
// follows: the library series (matched to TMDB like the series screen does) and the monitoring subscriptions whose
// query finds a TMDB show. Only shows TMDB lists as returning or in production count. Each show's card gives the
// seasons to read; the seasons' episodes give the days. At most 2 lookups run at a time; the answers come from the
// catalog client's cache when fresh. The rows' «Смотреть» comes from the monitoring findings at render time.
import { signal } from '@preact/signals';
import { lang } from '../../../src/i18n';
import { addDays } from '../../../src/catalog/discoverQuery';
import { catalogErrorCode, type CatalogClient, type CatalogErrorCode } from '../../../src/catalog/client';
import type { CatalogCard, SeasonDetails } from '../../../src/catalog/tmdb';
import { parseEpisodeRange } from '../../../src/monitor/episodes';
import { yearOf } from '../../../src/monitor/newEpisodes';
import { EPISODES_ID, type Finding, type Subscription } from '../../../src/monitor/types';
import type { Torrent } from '../../../src/api/types';
import { phoneCatalog } from '../catalog/phoneCatalog';
import { groupLibrary, singleGroup, type SeriesGroup } from './seriesGroups';
import { matchSeries } from './seriesMatch';
import { findShow, showQueries } from './tmdbShow';
import { isoDay, upcomingSeasons } from './seriesStatus';
import { dayHeader } from './releaseDates';

/** Days ahead the calendar shows. */
export const AHEAD_DAYS = 30;
/** Days back an aired episode stays («вышла»). */
export const BACK_DAYS = 3;
const MAX_LOOKUPS = 2;
/** A calendar older than this is gathered again when the tab opens. */
export const STALE_MS = 30 * 60 * 1000;

export type CalStatus = 'future' | 'today' | 'aired';

/** A followed show: its card, the library torrents and the subscriptions that stand for it. */
export interface CalShow { card: CatalogCard; hashes: string[]; subIds: string[]; }

export interface CalEntry {
  show: CalShow;
  season: number;
  episode: number;
  /** The episode's name ('' when TMDB has none). */
  name: string;
  airDate: string;
  status: CalStatus;
}

export interface CalDay { iso: string; label: string; entries: CalEntry[]; }

/** TMDB says the show goes on: returning, or in production. */
export function followable(card: CatalogCard): boolean {
  return card.kind === 'tv' && (card.status === 'returning' || card.status === 'production');
}

/** The seasons to read: the next episode's, the one on air when it aired lately, and those starting within the window. */
export function calendarSeasons(card: CatalogCard, now: number = Date.now()): number[] {
  const today = isoDay(now);
  const out: number[] = [];
  const add = (n: number) => {
    if (n > 0 && out.indexOf(n) < 0) out.push(n);
  };
  const ne = card.nextEpisode;
  if (ne) add(ne.season);
  let current = 0;
  card.seasons.forEach((s) => {
    if (s.aired > 0 && s.number > current) current = s.number;
  });
  if (current && card.lastAirDate && card.lastAirDate >= addDays(today, -BACK_DAYS)) add(current);
  const last = addDays(today, AHEAD_DAYS);
  upcomingSeasons(card, now).forEach((u) => {
    if (u.airDate && u.airDate <= last) add(u.number);
  });
  return out;
}

function statusOf(airDate: string, today: string): CalStatus {
  return airDate > today ? 'future' : airDate === today ? 'today' : 'aired';
}

/**
 * The show's episodes within the window (BACK_DAYS ago .. AHEAD_DAYS ahead) from its seasons; the card's next
 * episode alone when no season tells it (not loaded or failed).
 */
export function calendarEntries(show: CalShow, seasons: SeasonDetails[], now: number = Date.now()): CalEntry[] {
  const today = isoDay(now);
  const from = addDays(today, -BACK_DAYS);
  const to = addDays(today, AHEAD_DAYS);
  const out: CalEntry[] = [];
  const seen: { [k: string]: boolean } = {};
  seasons.forEach((s) => {
    s.episodes.forEach((e) => {
      if (!e.airDate || e.airDate < from || e.airDate > to || seen[s.number + ':' + e.n]) return;
      seen[s.number + ':' + e.n] = true;
      out.push({ show: show, season: s.number, episode: e.n, name: e.title, airDate: e.airDate, status: statusOf(e.airDate, today) });
    });
  });
  const ne = show.card.nextEpisode;
  if (ne && ne.airDate && ne.airDate >= from && ne.airDate <= to && !seen[ne.season + ':' + ne.episode]) {
    out.push({ show: show, season: ne.season, episode: ne.episode, name: '', airDate: ne.airDate, status: statusOf(ne.airDate, today) });
  }
  return out;
}

/** The entries by day, days in order; within a day by show title, then season and episode. */
export function groupByDay(entries: CalEntry[], now: number = Date.now()): CalDay[] {
  const sorted = entries.slice().sort((a, b) => {
    if (a.airDate !== b.airDate) return a.airDate < b.airDate ? -1 : 1;
    const ta = a.show.card.title.toLowerCase();
    const tb = b.show.card.title.toLowerCase();
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.season - b.season || a.episode - b.episode;
  });
  const days: CalDay[] = [];
  sorted.forEach((e) => {
    const last = days[days.length - 1];
    if (last && last.iso === e.airDate) last.entries.push(e);
    else days.push({ iso: e.airDate, label: dayHeader(e.airDate, now), entries: [e] });
  });
  return days;
}

function covers(from: number | undefined, to: number | undefined, episode: number): boolean {
  if (to === undefined) return false;
  return (from === undefined ? to : from) <= episode && episode <= to;
}

/**
 * The monitoring finding that has the entry's episode, the newest first: a new-episodes finding of one of the show's
 * library torrents, or a finding of one of its subscriptions whose title holds that season and episode; null if none.
 */
export function findingFor(entry: CalEntry, findings: Finding[]): Finding | null {
  const hashes = entry.show.hashes.map((h) => h.toLowerCase());
  let best: Finding | null = null;
  findings.forEach((f) => {
    let hit = false;
    if (f.subId === EPISODES_ID && f.episodes) {
      const e = f.episodes;
      hit = hashes.indexOf(e.torrentHash.toLowerCase()) >= 0 && e.season === entry.season && covers(e.from !== undefined ? e.from : e.haveTo + 1, e.to, entry.episode);
    } else if (entry.show.subIds.indexOf(f.subId) >= 0) {
      const r = parseEpisodeRange(f.result.Title);
      const s = r.season;
      const sTo = r.seasonTo !== undefined ? r.seasonTo : s;
      hit = s !== undefined && sTo !== undefined && s <= entry.season && entry.season <= sTo && covers(r.from, r.to, entry.episode);
    }
    if (hit && (!best || f.at > best.at)) best = f;
  });
  return best;
}

// --- gathering

export interface CalState {
  /** Gathering now. */
  loading: boolean;
  entries: CalEntry[];
  /** Nothing could be asked (offline, no key) and nothing is known. */
  error: CatalogErrorCode | null;
  /** When the last gathering ended (0: never). */
  at: number;
  lang: string;
}

const EMPTY: CalState = { loading: false, entries: [], error: null, at: 0, lang: '' };
export const calendarState = signal<CalState>(EMPTY);

let generation = 0;
/** Subscription query → its show card (null: not a show); per language. */
const subShows = new Map<string, CatalogCard | null>();

/** Runs `run` over the items, at most `limit` at a time; resolves when all are done (failures included). */
export function pool<T>(items: T[], limit: number, run: (x: T) => Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    let active = 0;
    const next = () => {
      if (i >= items.length && active === 0) {
        resolve();
        return;
      }
      while (active < limit && i < items.length) {
        const x = items[i++];
        active++;
        let p: Promise<unknown>;
        try {
          p = run(x);
        } catch (e) {
          p = Promise.reject(e);
        }
        p.then(done, done);
      }
    };
    const done = () => {
      active--;
      next();
    };
    next();
  });
}

/** The show of a subscription query: none when TMDB's best answer for it is a film. */
function subShow(c: CatalogClient, query: string): Promise<CatalogCard | null> {
  const key = lang.peek() + '|' + query.trim().toLowerCase();
  const hit = subShows.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const first = showQueries(query)[0] || query;
  const keep = (card: CatalogCard | null) => {
    subShows.set(key, card);
    return card;
  };
  return c.search(first, 1).then((r) => {
    const top = r.items[0];
    if (top && top.kind === 'movie') return keep(null);
    return findShow(c, query, yearOf(query) || 0).then((show) => (show ? c.card('tv', show.id).then(keep) : keep(null)));
  });
}

/** The library's series: the groups and the lone series torrents. */
export function librarySeries(list: Torrent[]): SeriesGroup[] {
  const out: SeriesGroup[] = [];
  groupLibrary(list).forEach((it) => {
    if (it.kind === 'series') out.push(it);
    else {
      const g = singleGroup(it.tor);
      if (g) out.push(g);
    }
  });
  return out;
}

type Source = { group: SeriesGroup } | { sub: Subscription };

/**
 * Gathers the calendar: the shows of the library series and the subscriptions (2 lookups at a time), merged by TMDB
 * id, then the seasons of the followable ones; the state fills in show by show. `fresh` reads the server's TMDB
 * settings again (pull to refresh).
 */
export function loadCalendar(list: Torrent[], subs: Subscription[], fresh?: boolean, now: number = Date.now()): Promise<void> {
  const my = ++generation;
  const l = lang.peek();
  const prev = calendarState.peek();
  calendarState.value = { loading: true, entries: prev.lang === l ? prev.entries : [], error: null, at: prev.at, lang: l };
  let firstError: CatalogErrorCode | null = null;
  // this gathering's entries: they replace the previous ones as soon as the first show is read
  const entries: CalEntry[] = [];
  const fail = (e: unknown) => {
    if (!firstError) firstError = catalogErrorCode(e);
  };
  return phoneCatalog(fresh).then(
    (c) => {
      const sources: Source[] = [];
      librarySeries(list).forEach((g) => sources.push({ group: g }));
      subs.forEach((s) => sources.push({ sub: s }));
      const shows: { [id: number]: CalShow } = {};
      const order: number[] = [];
      const resolve = (src: Source): Promise<unknown> => {
        const p = 'group' in src ? matchSeries(src.group) : subShow(c, src.sub.query);
        return p.then((card) => {
          if (my !== generation || !card || !followable(card)) return;
          let show = shows[card.id];
          if (!show) {
            show = shows[card.id] = { card: card, hashes: [], subIds: [] };
            order.push(card.id);
          }
          if ('group' in src) src.group.members.forEach((m) => show.hashes.push(m.hash));
          else show.subIds.push(src.sub.id);
        }, fail);
      };
      const publish = () => {
        if (my !== generation) return;
        calendarState.value = { loading: true, entries: entries.slice(), error: null, at: calendarState.peek().at, lang: l };
      };
      return pool(sources, MAX_LOOKUPS, resolve).then(() => {
        if (my !== generation) return;
        return pool(order, MAX_LOOKUPS, (id) => {
          const show = shows[id];
          const seasons: SeasonDetails[] = [];
          const numbers = calendarSeasons(show.card, now);
          let chain: Promise<unknown> = Promise.resolve();
          numbers.forEach((n) => {
            chain = chain.then(() => c.season(show.card.id, n).then((s) => {
              seasons.push(s);
            }, fail));
          });
          return chain.then(() => {
            if (my !== generation) return;
            calendarEntries(show, seasons, now).forEach((e) => entries.push(e));
            publish();
          });
        });
      });
    },
    fail,
  ).then(() => {
    if (my !== generation) return;
    const code: CatalogErrorCode | null = firstError;
    const blocking = !entries.length && (code === 'offline' || code === 'nokey') ? code : null;
    calendarState.value = { loading: false, entries: entries.slice(), error: blocking, at: Date.now(), lang: l };
  });
}

/** Tests: forget the gathered calendar and the subscription matches. */
export function resetCalendar(): void {
  generation++;
  subShows.clear();
  calendarState.value = EMPTY;
}

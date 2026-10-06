// «Новое» → «Календарь»: the episodes of the coming 30 days (and the last 3 days, «вышла») of the series the person
// follows: the library series (matched to TMDB like the series screen does) and the monitoring subscriptions whose
// query finds a TMDB show. Only shows TMDB lists as returning or in production count. Each show's card gives the
// seasons to read; the seasons' episodes give the days. At most 2 lookups run at a time; the answers come from the
// catalog client's cache when fresh. The rows' «Смотреть» comes from the monitoring findings at render time.
import { signal } from '@preact/signals';
import { lang } from '../../../src/i18n';
import { addDays } from '../../../src/catalog/discoverQuery';
import { catalogErrorCode, type CatalogClient, type CatalogErrorCode } from '../../../src/catalog/client';
import type { CatalogCard, CatalogTitle, SeasonDetails } from '../../../src/catalog/tmdb';
import { parseEpisodeRange } from '../../../src/monitor/episodes';
import { seriesNames, seriesQuery, yearOf } from '../../../src/monitor/newEpisodes';
import { loadJson, saveJson, isObject } from '../../../src/store/storage';
import { EPISODES_ID, type Finding, type Subscription } from '../../../src/monitor/types';
import type { Torrent } from '../../../src/api/types';
import { phoneCatalog } from '../catalog/phoneCatalog';
import { groupLibrary, singleGroup, type SeriesGroup } from './seriesGroups';
import { knownOver, matchSeries } from './seriesMatch';
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

/** «Эпизод 7», «Episode 7», «Серия 7»: TMDB's stand-in for an episode with no name yet. */
const PLACEHOLDER_NAME = /^(\u044d\u043f\u0438\u0437\u043e\u0434|episode|\u0441\u0435\u0440\u0438\u044f)\s*\d+$/i;

/** The episode's real name: '' for none or a placeholder («Эпизод 7»). */
export function realEpisodeName(name: string): string {
  const n = (name || '').trim();
  return PLACEHOLDER_NAME.test(n) ? '' : n;
}

/** One row of a day: a show's episodes of one season aired that day. */
export interface CalRow {
  show: CalShow;
  season: number;
  /** The episode numbers, ascending. */
  episodes: number[];
  /** The episode's real name; '' when there is none or the row has several episodes. */
  name: string;
  airDate: string;
  status: CalStatus;
  /** The row's entries, one per episode. */
  entries: CalEntry[];
}

function two(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/**
 * The episodes of a season as one code: «S13E07», «S13E07–E08» (consecutive), «S13E07, E09» (apart),
 * «S13E07–E08, E10» (both).
 */
export function episodesCode(season: number, episodes: number[]): string {
  const eps = episodes.slice().sort((a, b) => a - b);
  const runs: string[] = [];
  let i = 0;
  while (i < eps.length) {
    let j = i;
    while (j + 1 < eps.length && eps[j + 1] === eps[j] + 1) j++;
    runs.push('E' + two(eps[i]) + (j > i ? '–E' + two(eps[j]) : ''));
    i = j + 1;
  }
  return 'S' + two(season) + runs.join(', ');
}

/** A day's entries as rows: the episodes of one show and season merged, the order of the entries kept. */
export function dayRows(entries: CalEntry[]): CalRow[] {
  const rows: CalRow[] = [];
  const at: { [k: string]: CalRow } = {};
  entries.forEach((e) => {
    const k = e.show.card.id + ':' + e.season + ':' + e.airDate;
    const row = at[k];
    if (row) {
      if (row.episodes.indexOf(e.episode) < 0) {
        row.episodes.push(e.episode);
        row.entries.push(e);
      }
      return;
    }
    rows.push((at[k] = { show: e.show, season: e.season, episodes: [e.episode], name: '', airDate: e.airDate, status: e.status, entries: [e] }));
  });
  rows.forEach((r) => {
    r.episodes.sort((a, b) => a - b);
    r.name = r.entries.length === 1 ? realEpisodeName(r.entries[0].name) : '';
  });
  return rows;
}

/** The row's line: «S13E07 · name», «S13E07–E08». */
export function rowLine(row: CalRow): string {
  return episodesCode(row.season, row.episodes) + (row.name ? ' · ' + row.name : '');
}

/** The newest finding that has one of the row's episodes; null if none. */
export function rowFinding(row: CalRow, findings: Finding[]): Finding | null {
  let best: Finding | null = null;
  row.entries.forEach((e) => {
    const f = findingFor(e, findings);
    if (f && (!best || f.at > best.at)) best = f;
  });
  return best;
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

/**
 * The series name a subscription query stands for, or '' when it looks like a film (a year with no season or episode
 * mark: «Formula 1 2024», «Дюна 2021») or has no name.
 */
export function subQueryName(query: string): string {
  const q = (query || '').trim();
  const r = parseEpisodeRange(q);
  if (yearOf(q) && r.season === undefined && r.to === undefined) return '';
  return seriesQuery(q) || '';
}

/** The show among the search items whose title or original title is the query's name (a TMDB show, not a film). */
export function pickSubShow(items: CatalogTitle[], name: string): CatalogTitle | null {
  const want = seriesNames(name);
  if (!want.length) return null;
  const top = items[0];
  // the best answer is a film: the subscription is about the film
  if (top && top.kind === 'movie') return null;
  for (let i = 0; i < items.length; i++) {
    const x = items[i];
    if (x.kind !== 'tv') continue;
    const names = seriesNames(x.title).concat(seriesNames(x.original));
    if (names.some((n) => want.indexOf(n) >= 0)) return x;
  }
  return null;
}

// subscription query -> TMDB show id (0: none) with its status, kept for SUB_TTL across launches
const SUB_KEY = 'tsp.subTmdb';
const SUB_TTL = 7 * 24 * 60 * 60 * 1000;
const SUB_MAX = 200;

interface SubSaved { id: number; s: string; at: number; }

function subSaved(): { [k: string]: SubSaved } {
  const raw = loadJson<{ [k: string]: unknown }>(SUB_KEY, {}, isObject);
  const out: { [k: string]: SubSaved } = {};
  Object.keys(raw).forEach((k) => {
    const v = raw[k] as { id?: unknown; s?: unknown; at?: unknown } | null;
    if (v && typeof v.id === 'number' && typeof v.at === 'number') out[k] = { id: v.id, s: typeof v.s === 'string' ? v.s : '', at: v.at };
  });
  return out;
}

function subRemember(key: string, card: CatalogCard | null): void {
  const map = subSaved();
  map[key] = { id: card ? card.id : 0, s: card && card.status ? card.status : '', at: Date.now() };
  const keys = Object.keys(map);
  if (keys.length > SUB_MAX) keys.sort((a, b) => map[a].at - map[b].at).slice(0, keys.length - SUB_MAX).forEach((k) => delete map[k]);
  saveJson(SUB_KEY, map);
}

/**
 * The show of a subscription query: its name must be the show's title or original title; a film-like query or a film
 * as TMDB's best answer gives none. One search, remembered for a week (a show known to be over is not asked again).
 */
function subShow(c: CatalogClient, query: string, force?: boolean): Promise<CatalogCard | null> {
  const key = lang.peek() + '|' + query.trim().toLowerCase();
  const hit = subShows.get(key);
  if (hit !== undefined && !(force && hit)) return Promise.resolve(hit);
  const keep = (card: CatalogCard | null) => {
    subShows.set(key, card);
    subRemember(key, card);
    return card;
  };
  const known = subSaved()[key];
  const age = known ? Date.now() - known.at : -1;
  const recent = known && age >= 0 && age < SUB_TTL ? known : null;
  if (!hit && recent && (recent.id === 0 || recent.s === 'ended' || recent.s === 'canceled')) {
    subShows.set(key, null);
    return Promise.resolve(null);
  }
  const opts = force ? { force: true } : undefined;
  if (hit) return c.card('tv', hit.id, opts).then(keep);
  if (recent && recent.id) return c.card('tv', recent.id, opts).then(keep);
  const name = subQueryName(query);
  if (!name) return Promise.resolve(keep(null));
  return c.search(name, 1).then((r) => {
    const show = pickSubShow(r.items, name);
    return show ? c.card('tv', show.id, opts).then(keep) : keep(null);
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
      // a series known (from a match of the last week) to be over, or not on TMDB, is not asked again
      librarySeries(list).forEach((g) => {
        if (!knownOver(g.key)) sources.push({ group: g });
      });
      subs.forEach((s) => sources.push({ sub: s }));
      const shows: { [id: number]: CalShow } = {};
      const order: number[] = [];
      const resolve = (src: Source): Promise<unknown> => {
        // a newer gathering took over: nothing more is asked for this one
        if (my !== generation) return Promise.resolve();
        const p = 'group' in src ? matchSeries(src.group, { force: !!fresh }) : subShow(c, src.sub.query, !!fresh);
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
          if (my !== generation) return Promise.resolve();
          const show = shows[id];
          const seasons: SeasonDetails[] = [];
          const numbers = calendarSeasons(show.card, now);
          let chain: Promise<unknown> = Promise.resolve();
          numbers.forEach((n) => {
            chain = chain.then(() => c.season(show.card.id, n, fresh ? { force: true } : undefined).then((s) => {
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

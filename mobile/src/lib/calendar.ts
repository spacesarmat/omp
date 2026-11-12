// «Новое» → «Календарь»: the episodes of the coming 30 days (and the last 3 days, «вышла») of the series the person
// follows: the library series (matched to TMDB like the series screen does) and the monitoring subscriptions whose
// query finds a TMDB show. Only shows TMDB lists as returning or in production count. Each show's card gives the
// seasons to read; the seasons' episodes give the days. At most 2 lookups run at a time; the answers come from the
// catalog client's cache when fresh. The rows' «Смотреть» comes from the monitoring findings at render time.
import { signal } from '@preact/signals';
import { lang, t } from '../../../src/i18n';
import { addDays } from '../../../src/catalog/discoverQuery';
import { catalogErrorCode, type CatalogClient, type CatalogErrorCode } from '../../../src/catalog/client';
import { episodeTorrentQuery, torrentQuery, type CatalogCard, type CatalogTitle, type SeasonDetails } from '../../../src/catalog/tmdb';
import { parseEpisodeRange } from '../../../src/monitor/episodes';
import { seriesNames, seriesQuery, yearOf } from '../../../src/monitor/newEpisodes';
import { loadJson, saveJson, isObject } from '../../../src/store/storage';
import { EPISODES_ID, type Finding, type Subscription } from '../../../src/monitor/types';
import type { Torrent } from '../../../src/api/types';
import { phoneCatalog } from '../catalog/phoneCatalog';
import { groupLibrary, singleGroup, type SeriesGroup } from '../../../src/lib/seriesGroups';
import { knownOver, matchSeries } from '../../../src/lib/seriesMatch';
import { isoDay, upcomingSeasons } from '../../../src/lib/seriesStatus';
import { realEpisodeName } from '../../../src/lib/episodeNames';
import { dayHeader } from './releaseDates';

export { realEpisodeName };

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

/** Where a tapped episode goes after the person confirms. Nothing is opened before that. */
export type CalGo =
  | { name: 'seasonCard'; id: number; season: number }
  | { name: 'add'; query: string; run: true };

export interface CalEpisodeActions {
  inCatalog: boolean;
  subscribed: boolean;
  /** «Открыть в каталоге» when the show has a catalog card, otherwise «Искать раздачи» for the season. */
  primary: CalGo;
  /** «Найти новую серию» when the show is in the catalog and the person follows it. */
  episode: CalGo | null;
}

export function episodeActions(row: { show: CalShow; season: number; episode: number }): CalEpisodeActions {
  const card = row.show.card;
  const inCatalog = card.kind === 'tv' && card.id > 0;
  const subscribed = inCatalog && row.show.subIds.length > 0;
  return {
    inCatalog: inCatalog,
    subscribed: subscribed,
    primary: inCatalog
      ? { name: 'seasonCard', id: card.id, season: row.season }
      : { name: 'add', query: torrentQuery(card, row.season), run: true },
    episode: subscribed ? { name: 'add', query: episodeTorrentQuery(card, row.season, row.episode), run: true } : null,
  };
}

function statusOf(airDate: string, today: string): CalStatus {
  return airDate > today ? 'future' : airDate === today ? 'today' : 'aired';
}

/** First and last day of a month (`month` is 0-11), as YYYY-MM-DD. */
export function monthBounds(year: number, month: number): { from: string; to: string } {
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let days = dim[month];
  if (month === 1 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) days = 29;
  return { from: year + '-' + pad(month + 1) + '-01', to: year + '-' + pad(month + 1) + '-' + pad(days) };
}

/**
 * Seasons that can hold an episode inside [from, to]: one whose own start is not after `to` and whose next season
 * has not already started before `from`, plus the next episode's season when that date is inside the range.
 */
export function seasonsInRange(card: CatalogCard, from: string, to: string): number[] {
  const out: number[] = [];
  const add = (n: number) => {
    if (n > 0 && out.indexOf(n) < 0) out.push(n);
  };
  const ne = card.nextEpisode;
  if (ne && ne.airDate && ne.airDate >= from && ne.airDate <= to) add(ne.season);
  const sorted = card.seasons.slice().sort((a, b) => a.number - b.number);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (!s.airDate || s.airDate > to) continue;
    const next = sorted[i + 1];
    if (next && next.airDate && next.airDate < from) continue;
    add(s.number);
  }
  return out;
}

/**
 * The show's episodes within the window (BACK_DAYS ago .. AHEAD_DAYS ahead, or `range` when a month is open) from
 * its seasons; the card's next episode alone when no season tells it (not loaded or failed).
 */
export function calendarEntries(show: CalShow, seasons: SeasonDetails[], now: number = Date.now(), range?: { from: string; to: string }): CalEntry[] {
  const today = isoDay(now);
  const from = range ? range.from : addDays(today, -BACK_DAYS);
  const to = range ? range.to : addDays(today, AHEAD_DAYS);
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
 * The episodes of a season as one code: «S13E07», «S13E07-E08» (consecutive), «S13E07, E09» (apart),
 * «S13E07-E08, E10» (both).
 */
export function episodesCode(season: number, episodes: number[]): string {
  const eps = episodes.slice().sort((a, b) => a - b);
  const runs: string[] = [];
  let i = 0;
  while (i < eps.length) {
    let j = i;
    while (j + 1 < eps.length && eps[j + 1] === eps[j] + 1) j++;
    runs.push('E' + two(eps[i]) + (j > i ? '-E' + two(eps[j]) : ''));
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

/**
 * «7 серия», «7-8 серия», «7, 9 серия». The season is included only when the caller says the show
 * has more than one (`withSeason`). `episodesCode` stays the SxxEyy form for search.
 */
export function humanEpisodes(season: number, episodes: number[], withSeason = false): string {
  const eps = episodes.slice().sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < eps.length) {
    let j = i;
    while (j + 1 < eps.length && eps[j + 1] === eps[j] + 1) j++;
    parts.push(j > i ? String(eps[i]) + '-' + String(eps[j]) : String(eps[i]));
    i = j + 1;
  }
  const head = t('library.episodeNamed', { n: parts.join(', ') });
  return withSeason ? t('library.seasonNamed', { n: season }) + ' · ' + head : head;
}

/** The row's line: «7 серия · name». A number (from `rows.map`) is ignored. `true` adds the season. */
export function rowLine(row: CalRow, opts?: boolean | number | { withSeason?: boolean }): string {
  const withSeason = typeof opts === 'number' ? false : typeof opts === 'boolean' ? opts : !!(opts && opts.withSeason);
  return humanEpisodes(row.season, row.episodes, withSeason) + (row.name ? ' · ' + row.name : '');
}

// --- list and month views

const VIEW_KEY = 'tsp.calView';
export type CalView = 'list' | 'month';

/** The view chosen last time. Anything else is the list. */
export function loadCalView(): CalView {
  return loadJson<unknown>(VIEW_KEY, 'list', (v) => v === 'list' || v === 'month') === 'month' ? 'month' : 'list';
}

export function saveCalView(v: CalView): void {
  saveJson(VIEW_KEY, v);
}

/** Episodes of shows that came from a subscription (a library-only show stays out). */
export function subscribedOnly(entries: CalEntry[]): CalEntry[] {
  return entries.filter((e) => e.show.subIds.length > 0);
}

export type CalListId = 'out' | 'week' | 'next' | 'later';

export interface CalListGroup {
  id: CalListId;
  label: string;
  rows: CalRow[];
}

function rowCmp(a: CalRow, b: CalRow): number {
  if (a.airDate !== b.airDate) return a.airDate < b.airDate ? -1 : 1;
  const ta = a.show.card.title.toLowerCase();
  const tb = b.show.card.title.toLowerCase();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.season - b.season || a.episodes[0] - b.episodes[0];
}

/** Monday of the local week that holds `iso` (the week starts on Monday). */
export function weekMonday(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const dow = new Date(+m[1], +m[2] - 1, +m[3]).getDay();
  return addDays(iso, -((dow + 6) % 7));
}

/**
 * List view: released episodes first (newest first), then upcoming in «Эта неделя», «Следующая», «Позже».
 * A week is Monday through Sunday. Today counts as released.
 */
export function listGroups(entries: CalEntry[], now: number = Date.now()): CalListGroup[] {
  const today = isoDay(now);
  const start = weekMonday(today);
  const nextStart = addDays(start, 7);
  const laterStart = addDays(start, 14);
  const buckets: { [k: string]: CalRow[] } = { out: [], week: [], next: [], later: [] };
  dayRows(entries).sort(rowCmp).forEach((r) => {
    if (r.status !== 'future') buckets.out.push(r);
    else if (r.airDate < nextStart) buckets.week.push(r);
    else if (r.airDate < laterStart) buckets.next.push(r);
    else buckets.later.push(r);
  });
  buckets.out.sort((a, b) => (a.airDate === b.airDate ? rowCmp(a, b) : a.airDate < b.airDate ? 1 : -1));
  const labels: { [k: string]: string } = {
    out: t('news.calOut'),
    week: t('news.calWeek'),
    next: t('news.calNext'),
    later: t('news.calLater'),
  };
  const order: CalListId[] = ['out', 'week', 'next', 'later'];
  const out: CalListGroup[] = [];
  order.forEach((id) => {
    if (buckets[id].length) out.push({ id, label: labels[id], rows: buckets[id] });
  });
  return out;
}

export interface CalMonthCell {
  iso: string;
  inMonth: boolean;
  today: boolean;
  /** Before today. */
  past: boolean;
  /** At least one episode belongs to a subscription. */
  mine: boolean;
  /** Episodes that day. */
  count: number;
  /** A poster for the marker; '' when none of that day's shows has one. */
  poster: string;
}

/** Six Monday-first weeks covering `month` (0-11), including the leading and trailing days. */
export function monthCells(year: number, month: number, entries: CalEntry[], now: number = Date.now()): CalMonthCell[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);
  const today = isoDay(now);
  const byDay: { [iso: string]: CalEntry[] } = {};
  entries.forEach((e) => {
    (byDay[e.airDate] || (byDay[e.airDate] = [])).push(e);
  });
  const cells: CalMonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = isoDay(d.getTime());
    const list = byDay[iso] || [];
    let poster = '';
    let mine = false;
    for (let j = 0; j < list.length; j++) {
      if (!poster && list[j].show.card.poster) poster = list[j].show.card.poster;
      if (list[j].show.subIds.length) mine = true;
    }
    cells.push({ iso, inMonth: d.getMonth() === month, today: iso === today, past: iso < today, mine, count: list.length, poster });
  }
  return cells;
}

/** Extra beyond three dots: «+2» for five episodes, '' for three or fewer. */
export function dayCountLabel(n: number): string {
  return n > 3 ? '+' + (n - 3) : '';
}

export interface CalListSection {
  id: string;
  label: string;
  rows: CalRow[];
  /** «Ранее» starts closed. */
  collapsed: boolean;
}

/** List by day. Days before yesterday fold into «Ранее». Empty days are absent. */
export function listDaySections(entries: CalEntry[], now: number = Date.now()): CalListSection[] {
  const yesterday = addDays(isoDay(now), -1);
  const earlier: CalEntry[] = [];
  const out: CalListSection[] = [];
  groupByDay(entries, now).forEach((day) => {
    if (day.iso < yesterday) earlier.push.apply(earlier, day.entries);
    else if (day.entries.length) out.push({ id: day.iso, label: day.label, rows: dayRows(day.entries), collapsed: false });
  });
  if (earlier.length) {
    const rows = dayRows(earlier);
    out.unshift({ id: 'earlier', label: t('news.calEarlier', { n: String(earlier.length) }), rows, collapsed: true });
  }
  return out;
}

export function monthTitle(year: number, month: number): string {
  const names = t('date.monthsNom').split(' ');
  return (names[month] || '') + ' ' + year;
}

/** Short weekday names, Monday first. */
export function weekdayHeads(): string[] {
  const w = t('date.weekdays').split(' ');
  return w.slice(1).concat(w[0] || '');
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  // Arithmetic, not `new Date(y, m, d)`: a faked Date clock can ignore the arguments.
  let m = month + delta;
  let y = year;
  while (m < 0) {
    m += 12;
    y -= 1;
  }
  while (m > 11) {
    m -= 12;
    y += 1;
  }
  return { year: y, month: m };
}

/** The day a month opens on: today when it is in the month, else the first day that has episodes, else ''. */
export function defaultMonthDay(year: number, month: number, entries: CalEntry[], now: number = Date.now()): string {
  const cells = monthCells(year, month, entries, now);
  for (let i = 0; i < cells.length; i++) if (cells[i].inMonth && cells[i].today) return cells[i].iso;
  for (let i = 0; i < cells.length; i++) if (cells[i].inMonth && cells[i].count > 0) return cells[i].iso;
  return '';
}

/** Horizontal month change: -1 previous, 1 next, 0 when the gesture is a scroll or too short. */
export const MONTH_SWIPE_PX = 48;
export function monthSwipe(dx: number, dy: number): -1 | 1 | 0 {
  if (Math.abs(dx) < MONTH_SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
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
/** Shows of the last full gather. Month reads ask seasons of these. */
let knownShows: CalShow[] = [];
/** When the list window was computed. Month reads must not move it. */
let listNow = 0;
/**
 * Episodes of one show in one calendar month (`id|YYYY-MM`). List and Month both read this.
 * `failed` is retried; it does not drop the other shows. A month is settled only when every show is `ok`.
 */
interface ShowMonth { status: 'ok' | 'failed' | 'partial'; entries: CalEntry[]; }
let slots: { [key: string]: ShowMonth } = {};
/** One read at a time per show, so a second ask waits and then skips what already succeeded. */
let inflight: { [id: string]: Promise<void> } = {};
/** Bumps when any show-month arrives, so the grid renders it. */
export const monthRev = signal(0);
/** Subscription query → its show card (null: not a show); per language. */
const subShows = new Map<string, CatalogCard | null>();

const NO_MONTH: CalEntry[] = [];

function ymOf(from: string): string {
  return from.slice(0, 7);
}

function slotKey(id: number, ym: string): string {
  return id + '|' + ym;
}

/** Whole months that overlap [from, to], each as its own first and last day. */
function monthsCovering(from: string, to: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let y = +from.slice(0, 4);
  let m = +from.slice(5, 7) - 1;
  const endY = +to.slice(0, 4);
  const endM = +to.slice(5, 7) - 1;
  while (y < endY || (y === endY && m <= endM)) {
    out.push(monthBounds(y, m));
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
    if (out.length > 36) break;
  }
  return out;
}

function listWindow(now: number): { from: string; to: string } {
  const today = isoDay(now);
  return { from: addDays(today, -BACK_DAYS), to: addDays(today, AHEAD_DAYS) };
}

/** Every stored episode whose air date sits in the list window. Month-only days stay out. */
function windowEntries(): CalEntry[] {
  if (!listNow) return [];
  const w = listWindow(listNow);
  const out: CalEntry[] = [];
  knownShows.forEach((show) => {
    const prefix = show.card.id + '|';
    Object.keys(slots).forEach((k) => {
      if (k.indexOf(prefix) !== 0) return;
      slots[k].entries.forEach((e) => {
        if (e.airDate >= w.from && e.airDate <= w.to) out.push(e);
      });
    });
  });
  return out;
}

function publishWindow(): void {
  const prev = calendarState.peek();
  calendarState.value = { loading: prev.loading, entries: windowEntries(), error: prev.error, at: prev.at, lang: prev.lang };
  monthRev.value = monthRev.value + 1;
}

/** True when every gathered show has a successful read of this month. */
function monthSettled(ym: string): boolean {
  if (!knownShows.length) return false;
  for (let i = 0; i < knownShows.length; i++) {
    const slot = slots[slotKey(knownShows[i].card.id, ym)];
    if (!slot || slot.status !== 'ok') return false;
  }
  return true;
}

/**
 * Reads `ranges` for one show. List passes `calendarSeasons` (a season on air lately counts even with no air date)
 * and stores a partial month, so Month can show those episodes and still finish the month. Month passes the seasons
 * that cover the month plus the list's seasons when the month overlaps the list window. A failed season marks only
 * this show and keeps episodes already stored.
 */
function loadShowMonths(
  c: CatalogClient,
  show: CalShow,
  ranges: { from: string; to: string }[],
  now: number,
  gen: number,
  fresh: boolean | undefined,
  onError: ((e: unknown) => void) | undefined,
  pick: (r: { from: string; to: string }) => number[],
  settle: 'ok' | 'partial',
): Promise<void> {
  const prev = inflight[show.card.id] || Promise.resolve();
  const run = prev.then(() => {
    if (gen !== generation) return;
    const pending = ranges.filter((r) => {
      const slot = slots[slotKey(show.card.id, ymOf(r.from))];
      return !slot || slot.status !== 'ok';
    });
    if (!pending.length) return;
    const numbers: number[] = [];
    pending.forEach((r) => {
      pick(r).forEach((n) => {
        if (n > 0 && numbers.indexOf(n) < 0) numbers.push(n);
      });
    });
    const seasons: SeasonDetails[] = [];
    let failed = false;
    let chain: Promise<unknown> = Promise.resolve();
    numbers.forEach((n) => {
      chain = chain.then(() => {
        if (gen !== generation) return;
        return c.season(show.card.id, n, fresh ? { force: true } : undefined).then((s) => {
          seasons.push(s);
        }, (e) => {
          failed = true;
          if (onError) onError(e);
        });
      });
    });
    return chain.then(() => {
      if (gen !== generation) return;
      pending.forEach((r) => {
        const key = slotKey(show.card.id, ymOf(r.from));
        const prevSlot = slots[key];
        const next = calendarEntries(show, seasons, now, r);
        slots[key] = {
          status: failed ? 'failed' : settle,
          entries: failed && prevSlot ? keepEntries(prevSlot.entries, next) : next,
        };
      });
      publishWindow();
    });
  });
  inflight[show.card.id] = run.then(() => {}, () => {});
  return run;
}

/** Previous episodes stay when a later read fails; a newer copy of the same episode replaces the old one. */
function keepEntries(prev: CalEntry[], next: CalEntry[]): CalEntry[] {
  const by: { [k: string]: CalEntry } = {};
  const order: string[] = [];
  const put = (e: CalEntry) => {
    const k = e.show.card.id + ':' + e.season + ':' + e.episode;
    if (!by[k]) order.push(k);
    by[k] = e;
  };
  prev.forEach(put);
  next.forEach(put);
  const out: CalEntry[] = [];
  order.forEach((k) => out.push(by[k]));
  return out;
}

/** Seasons for an open month: the range, plus the list's seasons when this month overlaps the list window. */
function seasonsForOpenMonth(show: CalShow, r: { from: string; to: string }): number[] {
  const out = seasonsInRange(show.card, r.from, r.to);
  const add = (n: number) => {
    if (n > 0 && out.indexOf(n) < 0) out.push(n);
  };
  if (listNow) {
    const w = listWindow(listNow);
    if (r.from <= w.to && r.to >= w.from) calendarSeasons(show.card, listNow).forEach(add);
  }
  const slot = slots[slotKey(show.card.id, ymOf(r.from))];
  if (slot) slot.entries.forEach((e) => add(e.season));
  return out;
}

/** Episodes stored for that month, from every show that has answered (a failed show does not hide the others). */
export function entriesForMonth(year: number, month: number): CalEntry[] {
  const ym = ymOf(monthBounds(year, month).from);
  const suffix = '|' + ym;
  const out: CalEntry[] = [];
  Object.keys(slots).forEach((k) => {
    if (k.slice(-suffix.length) !== suffix) return;
    slots[k].entries.forEach((e) => out.push(e));
  });
  return out.length ? out : NO_MONTH;
}

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
  knownShows = [];
  slots = {};
  inflight = {};
  listNow = now;
  monthRev.value = monthRev.value + 1;
  const l = lang.peek();
  const prev = calendarState.peek();
  const win = listWindow(now);
  const ranges = monthsCovering(win.from, win.to);
  calendarState.value = { loading: true, entries: prev.lang === l ? prev.entries : [], error: null, at: prev.at, lang: l };
  let firstError: CatalogErrorCode | null = null;
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
      return pool(sources, MAX_LOOKUPS, resolve).then(() => {
        if (my !== generation) return;
        knownShows = order.map((id) => shows[id]);
        return pool(knownShows, MAX_LOOKUPS, (show) => {
          if (my !== generation) return Promise.resolve();
          return loadShowMonths(c, show, ranges, now, my, fresh, fail, () => calendarSeasons(show.card, now), 'partial');
        });
      });
    },
    fail,
  ).then(() => {
    if (my !== generation) return;
    const code: CatalogErrorCode | null = firstError;
    const entries = windowEntries();
    const blocking = !entries.length && (code === 'offline' || code === 'nokey' || code === 'badkey' || code === 'unreachable') ? code : null;
    calendarState.value = { loading: false, entries: entries, error: blocking, at: Date.now(), lang: l };
    monthRev.value = monthRev.value + 1;
  });
}

/**
 * Fills one month from the shared per-show store. Shows already `ok` are skipped. A show that fails is marked
 * `failed` and asked again next time; the shows that succeeded stay on screen. No-op until the gather has shows.
 */
export function ensureCalendarSpan(from: string, to: string, now: number = Date.now()): Promise<void> {
  if (!from || !to || from > to || !knownShows.length || monthSettled(ymOf(from))) return Promise.resolve();
  const gen = generation;
  const shows = knownShows.slice();
  return phoneCatalog(false).then(
    (c) => pool(shows, MAX_LOOKUPS, (show) => {
      if (gen !== generation) return Promise.resolve();
      return loadShowMonths(c, show, [{ from: from, to: to }], now, gen, false, undefined, (r) => seasonsForOpenMonth(show, r), 'ok');
    }),
    () => {},
  );
}

/** Tests: forget the gathered calendar and the subscription matches. */
export function resetCalendar(): void {
  generation++;
  knownShows = [];
  slots = {};
  inflight = {};
  listNow = 0;
  monthRev.value = monthRev.value + 1;
  subShows.clear();
  calendarState.value = EMPTY;
}

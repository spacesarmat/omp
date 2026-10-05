// New episodes of the library series: search by the series name, a release of the same season with a later last
// episode than the torrent has; the same quality and the same source / release group are preferred. Torrents whose
// journal says omp.w: false («Не следить») and packs of seasons are skipped. Chromium 53 safe (no \b next to Cyrillic).
import type { Torrent } from '../api/types';
import { guessCategory } from '../lib/categoryGuess';
import { fileKind, parseEpisode } from '../lib/episodes';
import { watchesNewEpisodes } from '../lib/journal';
import { posterQuery, titleCore } from '../lib/posterSearch';
import { normalizeTitle } from '../sources/merge';
import { searchAll, type SearchHandle } from '../sources/search';
import { qualityOf } from '../sources/view';
import type { SourceContext, SourceResult } from '../sources/types';
import type { CheckOptions } from './check';
import { parseEpisodeRange } from './episodes';
import { addFindings, rememberSeen, seenKeys } from './subs';
import { EPISODES_ID, type Finding } from './types';
import { displayTitle } from '../lib/torrentName';

/** The fields of a library torrent the check needs. */
export type LibraryTorrent = Pick<Torrent, 'hash' | 'title' | 'category' | 'data' | 'file_stats'>;

export interface NewEpisodes {
  /** Library torrent (lowercase infohash). */
  torrentHash: string;
  season: number;
  /** Last episode the library torrent has. */
  haveTo: number;
  /** Range of the candidate. */
  from?: number;
  to: number;
  /** The best newer release. */
  candidate: SourceResult;
  /** Other newer releases, best first («Другая раздача»). */
  others: SourceResult[];
}

export interface NewEpisodesOptions extends CheckOptions {
  /** Source id the library torrent came from, when known: preferred like the release group. */
  source?: string;
}

// «… 2 сезон 1-8 серия», «… 1-8 серии», «… Сезон: 1»: everything from the season / episodes on
const SEASON_WORDS = /(?:^|[\s.,:;-])(?:(?:\d{1,4}\s*[-–—]\s*)?\d{1,4}\s*(?:-?(?:й|ый|я)\s*)?)?(?:сезон|season|серии|серия|эпизод)[\s\S]*$/i;
// a year, not a resolution like 1920x1080
const YEAR = /(?:^|[^0-9])((?:19|20)\d\d)(?![0-9])(?!\s*[xх*×])/;

function head(title: string): string {
  const t = (title || '').trim();
  let end = t.length;
  ['[', '('].forEach((c) => {
    const at = t.indexOf(c);
    if (at > 0 && at < end) end = at;
  });
  return t.slice(0, end);
}

/** The whole name of one title variant (no word limit). */
function cleanName(part: string): string {
  return titleCore(part.replace(SEASON_WORDS, ''));
}

/** Search query for the series: the first title variant without season, episodes, year and quality. */
export function seriesQuery(title: string): string {
  const parts = head(title).split('/');
  for (let i = 0; i < parts.length; i++) {
    const q = posterQuery(cleanName(parts[i]));
    if (q) return q;
  }
  return '';
}

/** Every title variant («Дом дракона / House of the Dragon»), normalized, for telling the same series. */
export function seriesNames(title: string): string[] {
  const out: string[] = [];
  head(title)
    .split('/')
    .forEach((p) => {
      const n = normalizeTitle(cleanName(p));
      if (n.length >= 2 && out.indexOf(n) < 0) out.push(n);
    });
  return out;
}

const BY = /(?:^|\s)(?:от|by)\s+([^|[\]()]+)/gi;

/** Release groups named in the title: «от Aleksan55», «by VLDeshka», «| Даблин»; normalized, 3+ letters. */
export function releaseGroups(title: string): string[] {
  const t = title || '';
  const raw: string[] = [];
  BY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BY.exec(t))) raw.push(m[1]);
  const bar = t.indexOf('|');
  if (bar >= 0) t.slice(bar + 1).split('|').forEach((p) => raw.push(p));
  const out: string[] = [];
  raw.forEach((r) =>
    r.split(/[,&+]/).forEach((x) => {
      const n = normalizeTitle(x);
      if (n.length >= 3 && !/^[0-9 ]+$/.test(n) && out.indexOf(n) < 0) out.push(n);
    }),
  );
  return out;
}

/** The release year (19xx / 20xx); null when none. */
export function yearOf(title: string): number | null {
  const m = YEAR.exec(title || '');
  return m ? parseInt(m[1], 10) : null;
}

export interface LibraryRange {
  season: number;
  from?: number;
  to: number;
}

/** Season and last episode of a library torrent: from its title, else from its episode files; null when unknown. */
export function libraryRange(t: LibraryTorrent): LibraryRange | null {
  const r = parseEpisodeRange(t.title);
  if (r.seasonTo !== undefined) return null;
  if (r.to !== undefined) {
    const out: LibraryRange = { season: r.season === undefined ? 1 : r.season, to: r.to };
    if (r.from !== undefined) out.from = r.from;
    return out;
  }
  let season = -1;
  let from = -1;
  let to = -1;
  (t.file_stats || []).forEach((f) => {
    if (fileKind(f.path) !== 'video') return;
    const e = parseEpisode(f.path);
    if (e.episode === null) return;
    const s = e.season === null ? 1 : e.season;
    if (s > season) {
      season = s;
      from = e.episode;
      to = e.episode;
    } else if (s === season) {
      if (e.episode < from) from = e.episode;
      if (e.episode > to) to = e.episode;
    }
  });
  return to >= 0 ? { season, from, to } : null;
}

/** A series of the library (category «Сериалы» or guessed by title) with episode numbers, not switched off. */
export function isWatchedSeries(t: LibraryTorrent): boolean {
  const c = t.category || '';
  // an explicit category other than «Сериалы» is the user's word; only an empty one is guessed
  if (c !== 'tv' && (c !== '' || guessCategory(t.title) !== 'tv')) return false;
  if (!watchesNewEpisodes(t.data)) return false;
  return libraryRange(t) !== null;
}

interface Scored {
  r: SourceResult;
  to: number;
  from?: number;
  score: number;
  i: number;
}

/** The best newer release among `results` for the library torrent, or null. */
export function pickNewer(t: LibraryTorrent, results: SourceResult[], prefer?: { source?: string }): NewEpisodes | null {
  const have = libraryRange(t);
  if (!have) return null;
  const names = seriesNames(t.title);
  const groups = releaseGroups(t.title);
  const quality = qualityOf(t.title);
  const haveYear = yearOf(t.title);
  const hash = (t.hash || '').toLowerCase();
  const list: Scored[] = [];
  results.forEach((r, i) => {
    if (hash && r.hash === hash) return;
    const range = parseEpisodeRange(r.Title);
    if (range.to === undefined || range.to <= have.to || range.seasonTo !== undefined) return;
    const year = yearOf(r.Title);
    if (haveYear !== null && year !== null && Math.abs(year - haveYear) > 1) return;
    if ((range.season === undefined ? 1 : range.season) !== have.season) return;
    if (!seriesNames(r.Title).some((n) => names.indexOf(n) >= 0)) return;
    const sameGroup = releaseGroups(r.Title).some((g) => groups.indexOf(g) >= 0);
    const sameSource = !!prefer && !!prefer.source && prefer.source === r.source;
    const score = (qualityOf(r.Title) === quality ? 2 : 0) + (sameGroup || sameSource ? 1 : 0);
    list.push({ r, to: range.to, from: range.from, score, i });
  });
  if (!list.length) return null;
  list.sort((a, b) => b.score - a.score || b.to - a.to || (b.r.Seed || 0) - (a.r.Seed || 0) || a.i - b.i);
  const best = list[0];
  const out: NewEpisodes = {
    torrentHash: hash,
    season: have.season,
    haveTo: have.to,
    to: best.to,
    candidate: best.r,
    others: list.slice(1).map((x) => x.r),
  };
  if (best.from !== undefined) out.from = best.from;
  return out;
}

/** Searches for a newer release of a watched library series; null when not watched or nothing newer. Never rejects. */
export function findNewEpisodes(ctx: SourceContext, t: LibraryTorrent, opts?: NewEpisodesOptions): Promise<NewEpisodes | null> {
  const o = opts || {};
  if (!isWatchedSeries(t)) return Promise.resolve(null);
  const query = seriesQuery(t.title);
  if (!query) return Promise.resolve(null);
  let h: SearchHandle;
  try {
    h = (o.search || searchAll)(query, { ctx, from: o.from, timeoutMs: o.timeoutMs });
  } catch (e) {
    return Promise.resolve(null);
  }
  return h.done.then(
    () => pickNewer(t, h.results(), { source: o.source }),
    () => null,
  );
}

/** `<hash>:<season>:<to>`: one notification per new last episode of a torrent. */
export function episodesKey(n: Pick<NewEpisodes, 'torrentHash' | 'season' | 'to'>): string {
  return n.torrentHash + ':' + n.season + ':' + n.to;
}

/**
 * Checks the watched series of the library one by one; returns (and saves) the findings of last episodes not reported
 * before. Never rejects.
 */
export function checkNewEpisodes(ctx: SourceContext, torrents: LibraryTorrent[], opts?: NewEpisodesOptions): Promise<Finding[]> {
  const o = opts || {};
  const at = o.now === undefined ? Date.now() : o.now;
  const watched = torrents.filter(isWatchedSeries);
  const found: Finding[] = [];
  let chain: Promise<void> = Promise.resolve();
  watched.forEach((t) => {
    chain = chain.then(() =>
      findNewEpisodes(ctx, t, o).then((n) => {
        if (!n) return;
        const key = episodesKey(n);
        const seen = seenKeys(EPISODES_ID) || [];
        if (seen.indexOf(key) >= 0) return;
        const f: Finding = {
          subId: EPISODES_ID,
          key,
          result: n.candidate,
          at,
          episodes: { torrentHash: n.torrentHash, torrentTitle: displayTitle(t), season: n.season, haveTo: n.haveTo, to: n.to },
        };
        if (n.from !== undefined) f.episodes!.from = n.from;
        rememberSeen(EPISODES_ID, [key]);
        addFindings([f]);
        found.push(f);
      }),
    );
  });
  return chain.then(() => found);
}

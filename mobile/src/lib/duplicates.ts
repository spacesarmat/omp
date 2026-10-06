// Duplicate releases in «Мои»: two torrents of one series that cover the same episodes (or one covers the other's),
// or two films with the same title and year. The better one by quality (monitor/quality) may stay; the worse one goes
// through «Заменить» (monitor/replace), so the watch history moves to the one that stays.
import { signal } from '@preact/signals';
import type { Torrent } from '../../../src/api/types';
import { isBetter } from '../../../src/monitor/quality';
import { replaceTorrent, type ReplaceClient, type ReplaceResult } from '../../../src/monitor/replace';
import { libraryKey } from '../../../src/catalog/library';
import { titleCore } from '../../../src/lib/posterSearch';
import { displayTitle } from '../../../src/lib/torrentName';
import { baseName, fileKind, type TorrentFile } from '../../../src/lib/episodes';
import { parseEpisodeRange } from '../../../src/monitor/episodes';
import { qualityLabel } from '../../../src/monitor/quality';
import { shortTitle } from '../../../src/lib/libraryView';
import { fmtSize, t, tp } from '../../../src/i18n';
import { fileEpisodes, hasMainVideo } from '../../../src/lib/categoryCheck';
import { torrents } from '../../../src/store/library';
import { filesOf } from '../watch';
import { groupLibrary, isSeries, seasonMembers, type SeriesGroup } from './seriesGroups';

/** The episodes per season a release really has (from its files). */
export type Coverage = { [season: number]: number[] };

/** A video under this share of the release's size is a sample or a trailer: it does not count. */
const SAMPLE_SHARE = 0.05;
/** Specials, OVAs, extras, recaps: never proven to be in another release. */
const SPECIAL = /(?:^|[^a-z0-9])(?:specials?|sp\d{0,2}|ova|oad|extras?|bonus|recap|s00e?\d*)(?:[^a-z0-9]|$)/i;
/** A fractional episode («12.5», a recap). */
const DECIMAL = /(?:^|[ex\[]|\s-\s|\s)\d{1,3}\.5(?![0-9])/i;

function sizeOf(f: TorrentFile): number {
  return typeof f.length === 'number' && f.length > 0 ? f.length : 0;
}

/** An explicit season of the release from its title («S01», «1 сезон», «S1E1-18»); null when the title says none. */
function titleSeason(tor: Torrent): number | null {
  const r = parseEpisodeRange(displayTitle(tor));
  if (r.season === undefined) return null;
  return r.seasonTo === undefined || r.seasonTo === r.season ? r.season : null;
}

/**
 * What a series release PROVABLY covers, for deciding a deletion: from its video files only (samples and trailers
 * under 5% of the size and non-video files aside). Null — never deletable, never covering — when the files are not
 * known; when any video names no episode, a fractional one («12.5») or a special («Special», «SP», «OVA», «S00»); or
 * when a file has no explicit season (neither in its name nor in the release title). Two releases agree only on
 * seasons both name.
 */
export function coverage(tor: Torrent): Coverage | null {
  const all = filesOf(tor).filter((f) => fileKind(f.path) === 'video');
  if (!all.length) return null;
  const total = filesOf(tor).reduce((n, f) => n + sizeOf(f), 0);
  const videos = all.filter((f) => !total || sizeOf(f) >= total * SAMPLE_SHARE);
  if (!videos.length) return null;
  const own = titleSeason(tor);
  const out: Coverage = {};
  for (let i = 0; i < videos.length; i++) {
    const name = baseName(videos[i].path);
    if (SPECIAL.test(name) || DECIMAL.test(name)) return null;
    const e = fileEpisodes(videos[i].path);
    if (!e) return null;
    const s = e.season !== null ? e.season : own;
    if (s === null || s === 0) return null;
    const eps = out[s] || [];
    e.episodes.forEach((x) => {
      if (eps.indexOf(x) < 0) eps.push(x);
    });
    out[s] = eps;
  }
  return out;
}

/** A film by its files: one main video (70%+ of the size). False when the files are not known. */
export function singleFilm(tor: Torrent): boolean {
  const files = filesOf(tor);
  return files.length > 0 && hasMainVideo(files);
}

/** The episodes a release provably has (0 when unknown or a film). */
export function episodeCount(tor: Torrent): number {
  const c = coverage(tor);
  if (!c) return 0;
  return Object.keys(c).reduce((n, k) => n + c[+k].length, 0);
}

/** «1080p WEB-DL · 18 серий · 5,4 ГБ» (the parts known). */
export function releaseLine(tor: Torrent, withSize: boolean): string {
  const n = isSeries(tor) ? episodeCount(tor) : 0;
  return [
    qualityLabel(displayTitle(tor)) || shortTitle(displayTitle(tor)),
    n ? tp('library.episodes', n) : '',
    withSize && tor.torrent_size ? fmtSize(tor.torrent_size) : '',
  ].filter(Boolean).join(' · ');
}

/** «Удалить 1080p WEB-DL · 18 серий · 5,4 ГБ, оставить 4K WEB-DL · 18 серий?». */
export function dropLine(worse: Torrent, better: Torrent): string {
  return t('series.dupDropLine', { drop: releaseLine(worse, true), keep: releaseLine(better, false) });
}

/** `a` has every episode `b` has (season by season). */
export function covers(a: Coverage, b: Coverage): boolean {
  const keys = Object.keys(b);
  if (!keys.length) return false;
  return keys.every((k) => {
    const x = a[+k];
    const y = b[+k];
    return !!x && y.every((e) => x.indexOf(e) >= 0);
  });
}

/** The release year: from the bracket or paren field («[2011, …]», «(2021)»), else a standalone year in the title. */
function filmYear(raw: string): number {
  const field = /[\[(](?:[^\])]*[^0-9\])])?((?:19|20)\d\d)(?![0-9])/.exec(raw);
  if (field) return +field[1];
  const any = /(?:^|[^0-9x])((?:19|20)\d\d)(?![0-9xp])/i.exec(raw);
  return any ? +any[1] : 0;
}

/**
 * The title and year keys of a film: each name of the head of the title («Русское / Original», the part before the
 * first « (» or « [» — director, cast and release fields never count); none without a year.
 */
export function filmKeys(tor: Torrent): string[] {
  const raw = displayTitle(tor);
  const year = filmYear(raw);
  if (!year) return [];
  let head = raw;
  [' (', ' ['].forEach((sep) => {
    const at = head.indexOf(sep);
    if (at > 0) head = head.slice(0, at);
  });
  const out: string[] = [];
  head.split(' / ').forEach((part) => {
    const core = titleCore(part);
    const k = core ? libraryKey(core, year) : '';
    if (k && out.indexOf(k) < 0) out.push(k);
  });
  return out;
}

function groupOf(list: Torrent[], tor: Torrent): SeriesGroup | null {
  const items = groupLibrary(list);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'series' && it.members.indexOf(tor) >= 0) return it;
  }
  return null;
}

/** The torrents of `list` that are duplicates of `tor`: one series and overlapping as a subset either way, or one film. */
export function duplicatesOf(list: Torrent[], tor: Torrent): Torrent[] {
  const others = list.filter((x) => x.hash.toLowerCase() !== tor.hash.toLowerCase());
  if (isSeries(tor)) {
    const g = groupOf(others.concat([tor]), tor);
    if (!g) return [];
    const mine = coverage(tor);
    if (!mine) return [];
    return g.members.filter((m) => {
      if (m === tor) return false;
      const theirs = coverage(m);
      return !!theirs && (covers(mine, theirs) || covers(theirs, mine));
    });
  }
  // films: both must be one main video by their files (a miniseries filed as a film never qualifies)
  const keys = singleFilm(tor) ? filmKeys(tor) : [];
  if (!keys.length) return [];
  return others.filter((x) => !isSeries(x) && singleFilm(x) && filmKeys(x).some((k) => keys.indexOf(k) >= 0));
}

/** After an add: the old release to drop for the new better one, or the new one to drop when an old one is better. */
export interface DupOffer { drop: 'old' | 'new'; fresh: Torrent; old: Torrent; }

/** Only a release the other one fully covers may go (dropping it loses no episode). */
export function dupOfferFor(list: Torrent[], fresh: Torrent): DupOffer | null {
  const dups = duplicatesOf(list, fresh);
  const series = isSeries(fresh);
  const cov = (t: Torrent) => (series ? coverage(t) : null);
  const holds = (a: Torrent, b: Torrent) => {
    if (!series) return true;
    const ca = cov(a);
    const cb = cov(b);
    return !!ca && !!cb && covers(ca, cb);
  };
  for (let i = 0; i < dups.length; i++) {
    if (isBetter(displayTitle(fresh), displayTitle(dups[i])) && holds(fresh, dups[i])) return { drop: 'old', fresh, old: dups[i] };
  }
  for (let i = 0; i < dups.length; i++) {
    if (isBetter(displayTitle(dups[i]), displayTitle(fresh)) && holds(dups[i], fresh)) return { drop: 'new', fresh, old: dups[i] };
  }
  return null;
}

/** The season's releases a better one of the same season fully covers, each with that better one. */
export function worseInSeason(g: SeriesGroup, season: number): { worse: Torrent; better: Torrent }[] {
  const rows = seasonMembers(g, season);
  const out: { worse: Torrent; better: Torrent }[] = [];
  rows.forEach((a) => {
    const ca = coverage(a);
    if (!ca) return;
    let best: Torrent | null = null;
    rows.forEach((b) => {
      if (b === a) return;
      const cb = coverage(b);
      if (!cb || !covers(cb, ca) || !isBetter(displayTitle(b), displayTitle(a))) return;
      if (!best || isBetter(displayTitle(b), displayTitle(best))) best = b;
    });
    if (best) out.push({ worse: a, better: best });
  });
  return out;
}

const magnetOf = (hash: string) => 'magnet:?xt=urn:btih:' + hash;

/** Drops `worse` for `better` (both in the library) through «Заменить»: its watch history moves to `better`. */
export function dropWorse(c: ReplaceClient, worse: Torrent, better: Torrent): Promise<ReplaceResult> {
  return replaceTorrent(c, worse.hash, magnetOf(better.hash), { title: better.title || displayTitle(better), keepOwn: true });
}

/** The offer shown after an add (DuplicateSheet). */
export const dupOffer = signal<DupOffer | null>(null);

/** Right after an add: offers to drop the worse of a duplicate pair. */
export function checkAddedDuplicate(hash: string, title: string, category?: string): void {
  const list = torrents.peek();
  const fresh = list.filter((x) => x.hash.toLowerCase() === hash.toLowerCase())[0] || ({ hash, title, category: category || '' } as Torrent);
  dupOffer.value = dupOfferFor(list, fresh);
}

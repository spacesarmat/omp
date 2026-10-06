// Duplicate releases in «Мои»: two torrents of one series that cover the same episodes (or one covers the other's),
// or two films with the same title and year. The better one by quality (monitor/quality) may stay; the worse one goes
// through «Заменить» (monitor/replace), so the watch history moves to the one that stays.
import { signal } from '@preact/signals';
import type { Torrent } from '../../../src/api/types';
import { parseEpisodeRange } from '../../../src/monitor/episodes';
import { isBetter } from '../../../src/monitor/quality';
import { replaceTorrent, type ReplaceClient, type ReplaceResult } from '../../../src/monitor/replace';
import { libraryKey } from '../../../src/catalog/library';
import { titleCore } from '../../../src/lib/posterSearch';
import { displayTitle } from '../../../src/lib/torrentName';
import { parseEpisode, playableFiles } from '../../../src/lib/episodes';
import { torrents } from '../../../src/store/library';
import { filesOf } from '../watch';
import { groupLibrary, isSeries, seasonMembers, seasonsOf, type SeriesGroup } from './seriesGroups';

/** The episodes per season a release has; 'all' when it holds a whole season with no episode list known. */
export type Coverage = { [season: number]: number[] | 'all' };

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to && out.length < 1000; i++) out.push(i);
  return out;
}

/** What a series release covers: the title's season and episode range, else its episode files, else whole seasons; null when unknown. */
export function coverage(tor: Torrent): Coverage | null {
  const title = displayTitle(tor);
  const r = parseEpisodeRange(title);
  const seasons = seasonsOf(tor);
  const out: Coverage = {};
  if (r.to !== undefined && seasons.length === 1) {
    out[seasons[0]] = range(r.from !== undefined ? r.from : r.to, r.to);
    return out;
  }
  let files = 0;
  playableFiles(filesOf(tor)).forEach((f) => {
    const e = parseEpisode(f.path);
    if (e.episode === null) return;
    const s = e.season !== null ? e.season : seasons.length === 1 ? seasons[0] : 1;
    const list = out[s];
    const eps = list && list !== 'all' ? list : [];
    if (eps.indexOf(e.episode) < 0) eps.push(e.episode);
    out[s] = eps;
    files++;
  });
  if (files) return out;
  if (!seasons.length) return null;
  seasons.forEach((s) => {
    out[s] = 'all';
  });
  return out;
}

/** `a` has every episode `b` has (season by season). */
export function covers(a: Coverage, b: Coverage): boolean {
  const keys = Object.keys(b);
  if (!keys.length) return false;
  return keys.every((k) => {
    const x = a[+k];
    const y = b[+k];
    if (!x) return false;
    if (x === 'all') return true;
    if (y === 'all') return false;
    return y.every((e) => x.indexOf(e) >= 0);
  });
}

/** The title and year keys of a film (each part of «Русское / Original»); none without a year. */
export function filmKeys(tor: Torrent): string[] {
  const raw = displayTitle(tor);
  const m = /(?:^|[^0-9])((?:19|20)\d\d)(?![0-9])/.exec(raw);
  if (!m) return [];
  const year = +m[1];
  const out: string[] = [];
  const add = (s: string) => {
    const core = titleCore(s);
    const k = core ? libraryKey(core, year) : '';
    if (k && out.indexOf(k) < 0) out.push(k);
  };
  add(raw);
  if (raw.indexOf(' / ') > 0) raw.split(' / ').forEach(add);
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
  const keys = filmKeys(tor);
  if (!keys.length) return [];
  return others.filter((x) => !isSeries(x) && filmKeys(x).some((k) => keys.indexOf(k) >= 0));
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

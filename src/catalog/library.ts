// Library matching of TMDB titles against torrent titles. Pure.
import { titleCore } from '../lib/posterSearch';
import { parseRelease } from '../sources/filters';

// ye as a char code: the guard strips regex literals but not string literals.
const YE = String.fromCharCode(0x435);

/** Lowercase, yo folded to ye, non-letters/digits to single spaces, plus '|' and the year (0 when unknown). */
export function libraryKey(title: string, year: number): string {
  const s = (title || '')
    .toLowerCase()
    .replace(/ё/g, YE)
    .replace(/[^a-z0-9а-я]+/g, ' ')
    .trim();
  return s + '|' + year;
}

export function yearOf(title: string): number {
  const re = /(?:^|[^0-9])((?:19|20)\d\d)(?![0-9])/;
  const m = re.exec(title || '');
  return m ? +m[1] : 0;
}

/** Keys of the torrents: the title proper (and each part of a 'a / b' title) with the year found in the title. */
export function libraryIndex(torrents: { title: string }[]): Set<string> {
  const idx = new Set<string>();
  torrents.forEach((tr) => {
    const raw = tr.title || '';
    const year = yearOf(raw);
    const add = (s: string): void => {
      const core = titleCore(s);
      if (core) idx.add(libraryKey(core, year));
    };
    add(raw);
    if (raw.indexOf(' / ') > 0) raw.split(' / ').forEach(add);
  });
  return idx;
}

/** True when the title or its original name (with the year, or with the year unknown) is in the index. */
export function inLibrary(idx: Set<string>, t: { title: string; original: string; year: number }): boolean {
  const names = [t.title, t.original];
  for (let i = 0; i < names.length; i++) {
    if (!names[i]) continue;
    if (idx.has(libraryKey(names[i], t.year)) || idx.has(libraryKey(names[i], 0))) return true;
  }
  return false;
}

/** The name part of libraryKey (no year). */
function nameKey(title: string): string {
  const k = libraryKey(title, 0);
  return k.slice(0, k.length - 2);
}

/** Every 'name|N' key of a torrent title, with that torrent's hash (possibly empty). */
function eachSeason(torrents: { title: string; hash?: string }[], visit: (key: string, hash: string) => void): void {
  torrents.forEach((tr) => {
    const raw = tr.title || '';
    const seasons = parseRelease(raw).seasons;
    if (!seasons.length) return;
    const hash = tr.hash || '';
    const add = (s: string): void => {
      const core = titleCore(s);
      if (!core) return;
      const name = nameKey(core);
      if (!name) return;
      seasons.forEach((n) => visit(name + '|' + n, hash));
    };
    add(raw);
    if (raw.indexOf(' / ') > 0) raw.split(' / ').forEach(add);
  });
}

/**
 * Keys 'name|N' of the series seasons in the torrents (from the season marks of the title; none without them),
 * each with the hash of the first torrent that has it.
 */
export function seasonIndex(torrents: { title: string; hash?: string }[]): Map<string, string> {
  const idx = new Map<string, string>();
  eachSeason(torrents, (k, hash) => {
    if (!idx.has(k)) idx.set(k, hash);
  });
  return idx;
}

/** Same keys as seasonIndex, with every torrent hash that carries the season (a season split across releases). */
export function seasonHashIndex(torrents: { title: string; hash?: string }[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  eachSeason(torrents, (k, hash) => {
    if (!hash) return;
    const cur = idx.get(k);
    if (!cur) idx.set(k, [hash]);
    else if (cur.indexOf(hash) < 0) cur.push(hash);
  });
  return idx;
}

/** The hash of the first torrent with season N of the series (its title or original name); '' when none. */
export function librarySeasonHash(idx: Map<string, string>, t: { title: string; original: string }, season: number): string {
  const names = [t.title, t.original];
  for (let i = 0; i < names.length; i++) {
    const k = names[i] ? nameKey(names[i]) + '|' + season : '';
    if (k && idx.has(k)) return idx.get(k) || '';
  }
  return '';
}

/** Every torrent hash of season N (title or original name), first-seen order, without duplicates. */
export function librarySeasonHashes(idx: Map<string, string[]>, t: { title: string; original: string }, season: number): string[] {
  const out: string[] = [];
  const names = [t.title, t.original];
  for (let i = 0; i < names.length; i++) {
    const k = names[i] ? nameKey(names[i]) + '|' + season : '';
    const list = k ? idx.get(k) : undefined;
    if (!list) continue;
    list.forEach((h) => {
      if (h && out.indexOf(h) < 0) out.push(h);
    });
  }
  return out;
}

/** The series names ('name' of the 'name|N' keys) that have a season in the index. */
export function seriesNames(idx: Map<string, string>): Set<string> {
  const out = new Set<string>();
  idx.forEach((_h, k) => { out.add(k.slice(0, k.lastIndexOf('|'))); });
  return out;
}

/** True when the series (its title or original name) has any season in the names of seriesNames. */
export function inLibrarySeries(names: Set<string>, t: { title: string; original: string }): boolean {
  return (!!t.title && names.has(nameKey(t.title))) || (!!t.original && names.has(nameKey(t.original)));
}

/** True when season N of the series (its title or original name) is in the season index. */
export function inLibrarySeason(idx: { has(k: string): boolean }, t: { title: string; original: string }, season: number): boolean {
  const names = [t.title, t.original];
  for (let i = 0; i < names.length; i++) {
    if (names[i] && idx.has(nameKey(names[i]) + '|' + season)) return true;
  }
  return false;
}

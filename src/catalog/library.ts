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

/**
 * Keys 'name|N' of the series seasons in the torrents (from the season marks of the title; none without them),
 * each with the hash of the first torrent that has it.
 */
export function seasonIndex(torrents: { title: string; hash?: string }[]): Map<string, string> {
  const idx = new Map<string, string>();
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
      seasons.forEach((n) => {
        const k = name + '|' + n;
        if (!idx.has(k)) idx.set(k, hash);
      });
    };
    add(raw);
    if (raw.indexOf(' / ') > 0) raw.split(' / ').forEach(add);
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

/** True when season N of the series (its title or original name) is in the season index. */
export function inLibrarySeason(idx: { has(k: string): boolean }, t: { title: string; original: string }, season: number): boolean {
  const names = [t.title, t.original];
  for (let i = 0; i < names.length; i++) {
    if (names[i] && idx.has(nameKey(names[i]) + '|' + season)) return true;
  }
  return false;
}

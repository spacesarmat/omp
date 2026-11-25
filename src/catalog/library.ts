// Library matching of TMDB titles against torrent titles. Pure.
import { titleCore } from '../lib/posterSearch';
import { rawReleaseOf } from '../lib/journal';
import { identityText } from '../lib/keptQuality';
import { parseRelease } from '../sources/filters';
import { titleSaysSeries } from '../lib/seriesGroups';
import type { Kind } from './tmdb';

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

/**
 * What the index key is about: 's|' a release that reads as a season pack, 'f|' any other release (a film, or a show
 * the release text says nothing about). A card only reads the keys of its own kind, so a season pack cannot claim a
 * film of the same name, and a release that names no year cannot claim every remake of it.
 */
const SERIES_TAG = 's|';
const FILM_TAG = 'f|';

/**
 * The season marks of the release text decide the tag. Both the shown title and the saved release string are read:
 * a rename by the person can drop the marks from the title while the saved string still carries them.
 */
function releaseTag(tr: { title: string; data?: string }): string {
  const texts = [identityText(tr), rawReleaseOf(tr.data)];
  for (let i = 0; i < texts.length; i++) {
    const s = texts[i];
    if (!s) continue;
    const r = parseRelease(s);
    // «Complete Series» and «Сезоны: 1-3» are no film title
    if (r.allSeasons || r.seasons.length > 1) return SERIES_TAG;
    // a single season number can be part of a name («Сезон охоты 2 / Open Season 2 (2008)»): only a series mark counts
    if (r.seasons.length === 1 && titleSaysSeries(s)) return SERIES_TAG;
  }
  return FILM_TAG;
}

export function yearOf(title: string): number {
  const re = /(?:^|[^0-9])((?:19|20)\d\d)(?![0-9])/;
  const m = re.exec(title || '');
  return m ? +m[1] : 0;
}

/** Keys of the torrents: the title proper (and each part of a 'a / b' title) with the year found in the release string. */
export function libraryIndex(torrents: { title: string; data?: string }[]): Set<string> {
  const idx = new Set<string>();
  torrents.forEach((tr) => {
    const raw = identityText(tr);
    const tag = releaseTag(tr);
    const year = yearOf(raw);
    const add = (s: string): void => {
      const core = titleCore(s);
      if (core) idx.add(tag + libraryKey(core, year));
    };
    add(raw);
    if (raw.indexOf(' / ') > 0) raw.split(' / ').forEach(add);
  });
  return idx;
}

/** The first torrent hash that matches the title (or its original name). '' when none. */
export function libraryTitleHash(list: { title: string; hash?: string; data?: string }[], t: { title: string; original: string; year: number }): string {
  for (let i = 0; i < list.length; i++) {
    const tr = list[i];
    if (tr.hash && inLibrary(libraryIndex([tr]), t)) return tr.hash;
  }
  return '';
}

/**
 * True when the title or its original name is in the index. A film card needs a film release of the same year; a
 * series card takes a season release whose year is the same or absent (those often name none), and a release that
 * reads as a film only when its year agrees. Without a kind both readings are allowed.
 */
export function inLibrary(idx: Set<string>, t: { title: string; original: string; year: number; kind?: Kind }): boolean {
  const names = [t.title, t.original];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name) continue;
    const exact = libraryKey(name, t.year);
    const yearless = libraryKey(name, 0);
    if (t.kind === 'movie') {
      if (idx.has(FILM_TAG + exact)) return true;
    } else if (t.kind === 'tv') {
      if (idx.has(SERIES_TAG + exact) || idx.has(SERIES_TAG + yearless) || idx.has(FILM_TAG + exact)) return true;
    } else if (idx.has(SERIES_TAG + exact) || idx.has(SERIES_TAG + yearless) || idx.has(FILM_TAG + exact) || idx.has(FILM_TAG + yearless)) {
      return true;
    }
  }
  return false;
}

/** The name part of libraryKey (no year). */
function nameKey(title: string): string {
  const k = libraryKey(title, 0);
  return k.slice(0, k.length - 2);
}

/** Every 'name|N' key of a torrent title, with that torrent's hash (possibly empty). */
function eachSeason(torrents: { title: string; hash?: string; data?: string }[], visit: (key: string, hash: string) => void): void {
  torrents.forEach((tr) => {
    const saved = rawReleaseOf(tr.data);
    const raw = saved || tr.title || '';
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
export function seasonIndex(torrents: { title: string; hash?: string; data?: string }[]): Map<string, string> {
  const idx = new Map<string, string>();
  eachSeason(torrents, (k, hash) => {
    if (!idx.has(k)) idx.set(k, hash);
  });
  return idx;
}

/** Same keys as seasonIndex, with every torrent hash that carries the season (a season split across releases). */
export function seasonHashIndex(torrents: { title: string; hash?: string; data?: string }[]): Map<string, string[]> {
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

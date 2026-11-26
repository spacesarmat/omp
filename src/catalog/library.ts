// Library matching of TMDB titles against torrent titles. Pure.
import { titleCore } from '../lib/posterSearch';
import { rawReleaseOf } from '../lib/journal';
import { identityText } from '../lib/keptQuality';
import { parseRelease } from '../sources/filters';
import { yearInTitle } from '../sources/queryParse';
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
 * A season label set off from the name: «(Сезон: 2)», «[Season 2]». Inside brackets a number and the word belong to
 * each other, which a film name never does - «Open Season 2 (2008)» keeps its name and gets no bracket label.
 */
const SEASON_LABEL = /[([][^)\]]*(?:сезон|season)[^)\]]*\d|[([][^)\]]*\d[^)\]]*(?:сезон|season)/i;

/**
 * The release text settles the tag: both the shown title and the saved release string are read, because a rename can
 * drop the marks from the title while the saved string still carries them. The server category is asked only when no
 * text says anything about seasons - OMP fills that category from the same loose guess, so a magnet added as
 * «Open Season 2 (2008)» arrives tagged «Сериалы» and must not become a season pack.
 */
function releaseTag(tr: { title: string; data?: string; category?: string }): string {
  const texts = [identityText(tr), rawReleaseOf(tr.data)];
  let namedSeason = false; // a lone season number that belongs to the name, not a mark
  for (let i = 0; i < texts.length; i++) {
    const s = texts[i];
    if (!s) continue;
    const r = parseRelease(s);
    // «Complete Series» and «Сезоны: 1-3» are no film title
    if (r.allSeasons || r.seasons.length > 1) return SERIES_TAG;
    if (r.seasons.length === 1) {
      // a series mark («2 сезон», S02) or a bracketed label («(Season 2)»)
      if (titleSaysSeries(s) || SEASON_LABEL.test(s)) return SERIES_TAG;
      namedSeason = true;
    }
  }
  if (namedSeason) return FILM_TAG;
  return tr.category === 'tv' ? SERIES_TAG : FILM_TAG;
}

/**
 * The year of a release line: the same reading the search uses. A number that is the whole name («1917») or stands
 * inside it («Бегущий по лезвию 2049») is not the year, so such a release carries no year and cannot claim a remake.
 */
export function yearOf(title: string): number {
  return yearInTitle(title);
}

/** A Russian release name: the script that separates a translation from another work. */
function hasCyrillic(s: string): boolean {
  return /[а-яё]/i.test(s || '');
}

/**
 * The ' / ' parts of a release title that name the SAME work. « / » is both a translation pair
 * («Дюна: Часть вторая / Dune: Part Two») and a list of different works in one pack («Дорама А / Дорама Б»).
 * A translation stands right next to the name it translates, so only the run of other-script parts that FOLLOWS the
 * first title belongs to that title: in «Крестьянин / Peasant / Маска вермильона / Vermillion Mask» the last part is
 * the alias of the second work, and marking its catalog card «В медиатеке» because someone bundled it is wrong.
 * The first part in the same script as the title proper starts another work, and everything after it is not ours.
 */
export function sameWorkParts(raw: string): string[] {
  if (raw.indexOf(' / ') < 0) return [];
  const parts = raw.split(' / ');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    if (hasCyrillic(parts[i]) === hasCyrillic(parts[0])) break;
    out.push(parts[i]);
  }
  return out;
}

/** Keys of the torrents: the title proper (and its translation) with the year found in the release string. */
export function libraryIndex(torrents: { title: string; data?: string; category?: string }[]): Set<string> {
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
    sameWorkParts(raw).forEach(add);
  });
  return idx;
}

/** The first torrent hash that matches the title (or its original name). '' when none. */
export function libraryTitleHash(list: { title: string; hash?: string; data?: string; category?: string }[], t: { title: string; original: string; year: number }): string {
  for (let i = 0; i < list.length; i++) {
    const tr = list[i];
    if (tr.hash && inLibrary(libraryIndex([tr]), t)) return tr.hash;
  }
  return '';
}

/**
 * True when the title or its original name is in the index. A film card needs a release that reads as a film and
 * names the same year, which is what stops a season pack and a yearless remake claim. A series card - and a caller
 * without a kind - also takes a release that names no year, because season packs rarely write one.
 */
export function inLibrary(idx: Set<string>, t: { title: string; original: string; year: number; kind?: Kind }): boolean {
  const names = [t.title, t.original];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name) continue;
    const exact = libraryKey(name, t.year);
    const yearless = libraryKey(name, 0);
    if (t.kind === 'movie') {
      // a film is owned only by a release that reads as a film and names the same year
      if (idx.has(FILM_TAG + exact)) return true;
      continue;
    }
    // a series card takes a release of either kind with the same year, or one that names no year at all: season
    // packs rarely write one, and a series release without any mark cannot be told from a film by its text
    if (idx.has(SERIES_TAG + exact) || idx.has(SERIES_TAG + yearless) || idx.has(FILM_TAG + exact) || idx.has(FILM_TAG + yearless)) {
      return true;
    }
  }
  return false;
}

/** The name part of libraryKey (no year). Exported so an id check uses exactly the same name normalization. */
export function nameKey(title: string): string {
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
    sameWorkParts(raw).forEach(add);
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

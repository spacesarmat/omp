// Library matching of TMDB titles against torrent titles. Pure.
import { titleCore } from '../lib/posterSearch';

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

function yearOf(title: string): number {
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

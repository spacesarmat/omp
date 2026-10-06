// Rows that have nothing to do with the query. Some sites (Anidub) ignore the search text and answer with their latest
// releases; a row is kept only when its title shares a meaningful word with the query. Years, resolutions and 1-2
// letter words do not count. Case-insensitive, with the same normalization as the duplicate merge (merge.ts). A word
// of 5+ letters also matches by its stem (the word less its last two letters), for inflected Russian titles.
// Chromium 53 safe.
import { normalizeTitle } from './merge';

const YEAR = /^(19|20)\d\d$/;
const RESOLUTION = /^(\d{3,4}[pi]|[48]k|uhd|fhd|hdr)$/;

/** The words of a query that a relevant title must share (one of them); [] when there are none. */
export function queryWords(query: string): string[] {
  const out: string[] = [];
  normalizeTitle(query)
    .split(' ')
    .forEach((w) => {
      if (w.length < 3 || YEAR.test(w) || RESOLUTION.test(w) || out.indexOf(w) >= 0) return;
      out.push(w);
    });
  return out;
}

/** The title shares a meaningful word with the query (always true for a query with none). */
export function isRelevant(title: string, words: string[]): boolean {
  if (!words.length) return true;
  const text = ' ' + normalizeTitle(title);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const stem = w.length >= 5 ? w.slice(0, w.length - 2) : w;
    if (text.indexOf(' ' + stem) >= 0) return true;
  }
  return false;
}

/** The rows whose title shares a meaningful word with the query. */
export function relevantRows<T extends { Title: string }>(list: T[], query: string): T[] {
  const words = queryWords(query);
  if (!words.length) return list.slice();
  return list.filter((r) => isRelevant(r.Title, words));
}

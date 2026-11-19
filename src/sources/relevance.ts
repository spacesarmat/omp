// Rows that have nothing to do with the query. Some sites (Anidub) ignore the search text and answer with their latest
// releases. A row stays when its title shares enough significant words with the query. Years, resolutions, stop words
// and season or episode tokens («11 сезон», «S11», «серия») do not count. One shared word is not enough for a query
// of three or more («ужасов» alone must not keep «Ресторан Ужасов»). Case-insensitive, ё as е, the same normalization
// as the duplicate merge (merge.ts). A word of 5+ letters also matches by its stem (the word less its last two
// letters), so an inflected Russian title still hits. A title is matched as a whole, so «Русское / English Title»
// hits whichever side the query used. Chromium 53 safe.
import { episodeRole, parseRelease } from './filters';
import { normalizeTitle } from './merge';
import { parseSearchQuery, yearFits } from './queryParse';

const YEAR = /^(19|20)\d\d$/;
const RESOLUTION = /^(\d{3,4}[pi]|[48]k|uhd|fhd|hdr)$/;
/** «s11», «s11e02», «e7», «1x02» after punctuation is stripped. */
const EPCODE = /^s\d{1,3}(e\d{1,3})?$|^e\d{1,3}$|^\d{1,2}x\d{1,3}$/;
/** Season and episode words, and function words of 3+ letters. Shorter ones are already dropped. */
const SKIP: { [w: string]: boolean } = {
  сезон: true, сезона: true, сезоне: true, сезону: true, сезоны: true, сезонов: true,
  серия: true, серии: true, серию: true, серий: true, серией: true,
  эпизод: true, эпизода: true, эпизодов: true,
  season: true, seasons: true, episode: true, episodes: true,
  для: true, или: true, что: true, как: true, это: true, при: true, над: true, под: true, без: true, про: true,
  его: true, все: true, еще: true, она: true, они: true, так: true, уже: true,
  the: true, and: true, for: true, from: true, with: true,
};

/** The words of a query a title is matched on; [] when the query has none (a year and a resolution only). */
export function queryWords(query: string): string[] {
  const out: string[] = [];
  normalizeTitle(query)
    .split(' ')
    .forEach((w) => {
      if (w.length < 3 || YEAR.test(w) || RESOLUTION.test(w) || EPCODE.test(w) || SKIP[w] || out.indexOf(w) >= 0) return;
      out.push(w);
    });
  return out;
}

/** How many significant words a query must share. One word: that word. Two: both. Three or more: at least two. */
export function matchesNeeded(wordCount: number): number {
  if (wordCount <= 2) return wordCount;
  return 2;
}

function stemOf(w: string): string {
  return w.length >= 5 ? w.slice(0, w.length - 2) : w;
}

/** How many query words start a word of the title (stem for a long word). */
export function matchCount(title: string, words: string[]): number {
  const text = ' ' + normalizeTitle(title);
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    if (text.indexOf(' ' + stemOf(words[i])) >= 0) n++;
  }
  return n;
}

/** The title shares enough significant words with the query (always true for a query with none). */
export function isRelevant(title: string, words: string[]): boolean {
  if (!words.length) return true;
  return matchCount(title, words) >= matchesNeeded(words.length);
}

/** One shared word when the query needs more: a weak hit, not a result. */
export function isSimilar(title: string, words: string[]): boolean {
  if (!words.length) return false;
  const n = matchCount(title, words);
  return n > 0 && n < matchesNeeded(words.length);
}

/** The rows whose title shares enough significant words with the query. */
export function relevantRows<T extends { Title: string }>(list: T[], query: string): T[] {
  const words = queryWords(query);
  if (!words.length) return list.slice();
  return list.filter((r) => isRelevant(r.Title, words));
}

/** Rows that share a word but not enough to be a result. */
export function similarRows<T extends { Title: string }>(list: T[], query: string): T[] {
  const words = queryWords(query);
  if (!words.length) return [];
  return list.filter((r) => isSimilar(r.Title, words));
}

export interface RelevanceSplit<T> { hits: T[]; similar: T[]; }

/** Hits first, weak matches second. Rows that share nothing are dropped. */
export function splitByRelevance<T extends { Title: string }>(list: T[], query: string): RelevanceSplit<T> {
  return splitByQueries(list, [query]);
}

/**
 * A row is a hit when it matches any of the queries (the typed title or a TMDB name).
 * One shared word of a longer query is similar. Rows that share nothing are dropped.
 */
export function splitByQueries<T extends { Title: string }>(list: T[], queries: string[]): RelevanceSplit<T> {
  const sets: string[][] = [];
  for (let i = 0; i < queries.length; i++) {
    const words = queryWords(queries[i]);
    if (words.length) sets.push(words);
  }
  if (!sets.length) return { hits: list.slice(), similar: [] };
  const hits: T[] = [];
  const similar: T[] = [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    let hit = false;
    let sim = false;
    for (let j = 0; j < sets.length; j++) {
      if (isRelevant(row.Title, sets[j])) hit = true;
      else if (isSimilar(row.Title, sets[j])) sim = true;
    }
    if (hit) hits.push(row);
    else if (sim) similar.push(row);
  }
  return { hits: hits, similar: similar };
}

/** Rows that match any query. */
export function relevantRowsAny<T extends { Title: string }>(list: T[], queries: string[]): T[] {
  return splitByQueries(list, queries).hits;
}

/**
 * What a screen shows for one typed query: title hits, then the season and episode from the query.
 * A full-season pack that includes the asked episode stays. A different episode does not.
 */
export function rowsForQuery<T extends { Title: string }>(list: T[], query: string, queries: string[]): T[] {
  const words = queries.length ? queries : [query];
  const hits = relevantRowsAny(list, words);
  const parsed = parseSearchQuery(query);
  if (!parsed.season && !parsed.episode) return hits;
  const out: T[] = [];
  for (let i = 0; i < hits.length; i++) {
    const info = parseRelease(hits[i].Title);
    if (parsed.season && !info.allSeasons && info.seasons.length && info.seasons.indexOf(parsed.season) < 0) continue;
    if (parsed.episode && episodeRole(hits[i].Title, parsed.season, parsed.episode) === 'other') continue;
    out.push(hits[i]);
  }
  return out;
}

/**
 * With a year chip on, a release that names a different year leaves the main list
 * (it is shown under "Показать ещё"). A title with no year stays.
 */
export function partitionByYear<T extends { Title: string }>(list: T[], year: number): { match: T[]; other: T[] } {
  if (!year) return { match: list.slice(), other: [] };
  const match: T[] = [];
  const other: T[] = [];
  for (let i = 0; i < list.length; i++) {
    if (yearFits(list[i].Title, year) === 'no') other.push(list[i]);
    else match.push(list[i]);
  }
  return { match: match, other: other };
}

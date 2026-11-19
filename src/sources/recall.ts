// Which strings to send to the trackers for one typed line: the cleaned title, TMDB's
// Russian and original names, then a transliteration if it is still a different string.
// A second, shorter list is the empty-result retry (no year, no subtitle).
// Chromium 53: no ?., no ??, no regex u flag.
import { normalizeTitle } from './merge';
import { dropSubtitle, type ParsedQuery } from './queryParse';
import { transliterate } from './translit';

/** Tracker requests per search, before the empty-result retry. Keeps a slow site inside its timeout. */
export const MAX_RECALL = 4;

export interface RecallHint {
  title: string;
  original: string;
  year: number;
  alts?: string[];
}

function pushUnique(out: string[], seen: { [k: string]: boolean }, s: string, cap: number): void {
  if (out.length >= cap) return;
  const q = (s || '').replace(/\s+/g, ' ').trim();
  if (!q) return;
  const k = normalizeTitle(q);
  if (!k || seen[k]) return;
  seen[k] = true;
  out.push(q);
}

/**
 * Queries for the trackers, in order, duplicates (ё as е, case, punctuation) removed.
 * `extras` are TMDB titles (Russian, original, alternative). At most MAX_RECALL.
 */
export function trackerQueries(parsed: ParsedQuery, extras: string[]): string[] {
  const out: string[] = [];
  const seen: { [k: string]: boolean } = {};
  pushUnique(out, seen, parsed.title, MAX_RECALL);
  for (let i = 0; i < extras.length; i++) pushUnique(out, seen, extras[i], MAX_RECALL);
  return out;
}

function looseYear(s: string): string {
  return (s || '')
    .replace(/(^|[^0-9])(\(?((?:19|20)\d\d)\)?)(?![0-9])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What to try once when the first queries found nothing relevant:
 * the title without a subtitle (":" or " - "), and the same without a year.
 * Strings already sent are left out.
 */
export function relaxedQueries(parsed: ParsedQuery, already: string[]): string[] {
  const seen: { [k: string]: boolean } = {};
  for (let i = 0; i < already.length; i++) {
    const k = normalizeTitle(already[i]);
    if (k) seen[k] = true;
  }
  const raw = parsed.raw || '';
  const short = dropSubtitle(parsed.title);
  const candidates = [short, dropSubtitle(raw), looseYear(dropSubtitle(raw)), looseYear(parsed.title), transliterate(short), transliterate(parsed.title)];
  const out: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const q = (candidates[i] || '').replace(/\s+/g, ' ').trim();
    if (!q || q === parsed.title) continue;
    const k = normalizeTitle(q);
    if (!k || seen[k]) continue;
    seen[k] = true;
    out.push(q);
    if (out.length >= 2) break;
  }
  return out;
}

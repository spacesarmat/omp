// What a person typed into search: a year (1900-2099), a season and an episode come out,
// and the rest is the title the trackers are asked for. A subtitle after ":" or " - " stays
// in the title; the empty-result retry drops it. Shared by the phone, the TV and the desktop.
// Chromium 53: no ?., no ??, no regex u flag, no lookbehind.
import { parseEpisodeRange } from '../monitor/episodes';

export interface ParsedQuery {
  raw: string;
  /** Title with the year, season and episode taken off. */
  title: string;
  year: number;
  season: number;
  episode: number;
}

function asYear(raw: string): number {
  const y = parseInt(raw, 10);
  return y >= 1900 && y <= 2099 ? y : 0;
}

/**
 * The release year, or 0. A year in parentheses wins (`2049 (2017)` is 2017):
 * the bare number can be part of the title. Otherwise the last standalone year.
 * A resolution (1080, 2160) is not a year.
 */
export function yearInTitle(text: string): number {
  const s = text || '';
  const paren = /\(((?:19|20)\d\d)\)/.exec(s);
  if (paren) return asYear(paren[1]);
  let last = 0;
  const re = /(?:^|[^0-9])((?:19|20)\d\d)(?![0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const y = asYear(m[1]);
    if (y) last = y;
  }
  return last;
}

// Prefix is group 1 and is kept. Everything else in the match is a mark we drop.
// Longer marks first, so "2 сезон 3 серия" and "s02e03" go in one cut.
const STRIP: RegExp[] = [
  /(^|[^a-z0-9])(s\d{1,2}[ ._-]?e\d{1,4}(?:\s*[\u2013\u2014-]\s*(?:s?\d{1,2})?e?\d{1,4})?)/gi,
  /(^|[^0-9a-zа-яё])(\d{1,2}[xх]\d{2,4}(?:\s*[\u2013\u2014-]\s*\d{1,4})?)/gi,
  /(^|[^a-z])(season\s+\d{1,2}\s+episodes?\s+\d{1,4})/gi,
  /(^|[^a-zа-яё])(сезон[аеуы]?\s+\d{1,2}\s+сери[яиюей]+\s+\d{1,4})/gi,
  /(^|[^0-9a-zа-яё])(\d{1,2}\s*(?:-?(?:й|ый)\s*)?сезон[аеуы]?\s+\d{1,4}\s*(?:-?(?:я|ая)\s*)?сери[яиюей]*)/gi,
  /(^|[^0-9a-zа-яё])(\d{1,2}\s*(?:-?(?:й|ый)\s*)?сезон[аеуы]?)/gi,
  /(^|[^a-zа-яё])((?:сезон[аеуы]?|season)\s*:?\s*\d{1,2})(?![0-9])/gi,
  /(^|[^0-9a-zа-яё])(\d{1,4}\s*[\u2013\u2014-]\s*\d{1,4}\s*сери[яиюей]*)/gi,
  /(^|[^0-9a-zа-яё])(\d{1,4}\s*(?:-?(?:я|ая)\s*)?сери[яиюей]*)/gi,
  /(^|[^a-zа-яё])((?:сери[яиюей]*|эпизод[аы]?|episodes?)\s*:?\s*\d{1,4})(?![0-9])/gi,
  /(^|[^a-z0-9])(s\d{1,2})(?=[^a-z0-9]|$)/gi,
  /(^|[^0-9])(\(?((?:19|20)\d\d)\)?)(?![0-9])/gi,
];

/** Season and one episode. "2 сезон 3 серия" is season 2, not season 3: the number after "сезон" is the episode. */
function readSeasonEpisode(text: string): { season: number; episode: number } {
  const t = text || '';
  let m = /(\d{1,2})\s*(?:-?(?:й|ый)\s*)?сезон[аеуы]?\s+(\d{1,3})\s*(?:-?(?:я|ая)\s*)?сери/i.exec(t);
  if (m) return { season: +m[1], episode: +m[2] };
  m = /сезон[аеуы]?\s*:?\s*(\d{1,2})\s+сери[яиюей]*\s*:?\s*(\d{1,3})/i.exec(t);
  if (m) return { season: +m[1], episode: +m[2] };
  m = /season\s+(\d{1,2})\s+episodes?\s+(\d{1,3})/i.exec(t);
  if (m) return { season: +m[1], episode: +m[2] };
  const range = parseEpisodeRange(t);
  const episode = range.from !== undefined && range.to === range.from ? range.from : 0;
  const season = range.season && !range.seasonTo ? range.season : 0;
  return { season: season, episode: episode };
}

function stripMarks(text: string): string {
  let s = text || '';
  for (let i = 0; i < STRIP.length; i++) {
    const re = STRIP[i];
    re.lastIndex = 0;
    s = s.replace(re, (_full, prefix: string) => (prefix || '') + ' ');
  }
  s = s.replace(/\(\s*\)/g, ' ').replace(/\[\s*\]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s.,:;|-]+|[\s.,:;|-]+$/g, '');
  return s.trim();
}

/**
 * Year, season and one episode out of a search line.
 * "Локи 2023", "Локи 2 сезон", "сезон 2 серия 3", "s02e03", "S2E3", "2x03",
 * "2 сезон 3 серия", "season 2 episode 3". A range ("1-6 серии") sets the season only.
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const text = (raw || '').replace(/\s+/g, ' ').trim();
  const found = readSeasonEpisode(text);
  const year = yearInTitle(text);
  let title = stripMarks(text);
  // A film whose name is the year ("1917") must still be searched.
  if (!title && year) title = String(year);
  return { raw: text, title: title, year: year, season: found.season, episode: found.episode };
}

/** The part before ":" or " - ". A hyphen inside a word ("Spider-Man") stays. */
export function dropSubtitle(title: string): string {
  let s = title || '';
  const colon = s.indexOf(':');
  if (colon > 0) s = s.slice(0, colon);
  const dash = s.indexOf(' - ');
  if (dash > 0) s = s.slice(0, dash);
  return s.replace(/\s+/g, ' ').trim();
}

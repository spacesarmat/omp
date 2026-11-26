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

/** A number that is a screen width, not a year: «1920x1080», «2048x1152». */
function widthAt(s: string, at: number, value: string): boolean {
  if (value !== '1920' && value !== '2048') return false;
  return /^\s*[xх*×]/.test(s.slice(at + value.length));
}

// A release line cannot name a year that has not come yet, so a bigger number is part of the name. Recomputed
// every few thousand calls: the year is read for every torrent of the library, and `new Date` there costs.
let capYear = 0;
let capCalls = 0;

function maxReleaseYear(): number {
  if (!capYear || (++capCalls & 4095) === 0) capYear = new Date().getFullYear() + 1;
  return capYear;
}

/**
 * The release year and where it stands in the text (`at` is -1 when there is none).
 * A number that is the whole title ("1917") is the name, not a year. A year in parentheses wins
 * ("2049 (2017)" is 2017): a bare number can be part of the name. Otherwise the last standalone year that
 * could be a release at all ("Blade Runner 2049 2017" is 2017, "Бегущий по лезвию 2099" is a name with no year).
 * A year range ("2022-2026") is not one year: see yearFits. A resolution (1080, 2160, 1920x1080) is not a year.
 */
export function yearOfText(text: string): { year: number; at: number } {
  const s = text || '';
  if (bareYear(s)) return { year: 0, at: -1 };
  const paren = /\(((?:19|20)\d\d)\)/.exec(s);
  if (paren) return { year: asYear(paren[1]), at: paren.index };
  if (yearRanges(s).length) return { year: 0, at: -1 };
  const max = maxReleaseYear();
  let last = { year: 0, at: -1 };
  const re = /(?:^|[^0-9])((?:19|20)\d\d)(?![0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const y = asYear(m[1]);
    if (!y || y > max) continue;
    const at = m.index + m[0].indexOf(m[1]);
    if (widthAt(s, at, m[1])) continue;
    last = { year: y, at: at };
  }
  return last;
}

export function yearInTitle(text: string): number {
  return yearOfText(text).year;
}

/**
 * Where the release year of the text stands, -1 when the text names none. The name of the work ends here:
 * a year-shaped number before it ("Бегущий по лезвию 2049") belongs to the name and must not be cut off.
 */
export function yearPosition(text: string): number {
  return yearOfText(text).at;
}

function yearRanges(text: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const re = /((?:19|20)\d\d)\s*[\u2013\u2014-]\s*((?:19|20)\d\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = asYear(m[1]);
    const b = asYear(m[2]);
    if (!a || !b) continue;
    out.push({ from: a < b ? a : b, to: a < b ? b : a });
  }
  return out;
}

/**
 * How a release's years relate to the asked year.
 * `yes` - the release names that year anywhere, or a range contains it (`2022-2026` contains 2022).
 * `no` - the release names another year.
 * `none` - the title names no year.
 */
export function yearFits(title: string, year: number): 'yes' | 'no' | 'none' {
  if (!year) return 'none';
  const s = title || '';
  const ranges = yearRanges(s);
  for (let i = 0; i < ranges.length; i++) {
    if (year >= ranges[i].from && year <= ranges[i].to) return 'yes';
  }
  const named = yearTokens(s);
  // a release of «Бегущий по лезвию 2049 (2017)» names both numbers, and either of them identifies it
  if (named.length) return named.indexOf(year) >= 0 ? 'yes' : 'no';
  if (ranges.length) return 'no';
  return 'none';
}

/** Every year the text names, in the order they stand (a bare whole-title number does not count). */
export function yearTokens(text: string): number[] {
  const s = text || '';
  if (bareYear(s)) return [];
  const out: number[] = [];
  const re = /(?:^|[^0-9])((?:19|20)\d\d)(?![0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const y = asYear(m[1]);
    if (!y || widthAt(s, m.index + m[0].indexOf(m[1]), m[1])) continue;
    if (out.indexOf(y) < 0) out.push(y);
  }
  return out;
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
];

/** Every year of a line where the line names a range instead of a year. */
const YEAR_MARK = /(^|[^0-9a-zа-яё])\(?(?:(?:19|20)\d\d)\)?(?![0-9])/gi;

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

/**
 * The marks of a release line out, the name left. `year` is the number read as the release year: only it leaves the
 * name, so «Бегущий по лезвию 2049 (2017)» keeps 2049 in it. With a year range («2019-2023») every year of the line
 * is a mark, not a name.
 */
function stripMarks(text: string, year: number): string {
  let s = text || '';
  for (let i = 0; i < STRIP.length; i++) {
    const re = STRIP[i];
    re.lastIndex = 0;
    s = s.replace(re, (_full, prefix: string) => (prefix || '') + ' ');
  }
  // Only the number read as the release year leaves the name. Written as two forms: a year given by the caller
  // needs a built pattern, and it must hold no letters (the i18n guard reads a Cyrillic range in a string as copy).
  const any = !year && yearRanges(s).length > 0;
  if (any) {
    YEAR_MARK.lastIndex = 0;
    s = s.replace(YEAR_MARK, ' ');
  } else if (year) {
    s = s.replace(new RegExp('(^|[^0-9])\\(?(' + year + ')\\)?(?![0-9])', 'g'), ' ');
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
  const bare = bareYear(text);
  // A film whose name is the year ("1917") must still be searched: the number is the title, not a filter.
  const year = bare ? 0 : yearInTitle(text);
  const title = bare ? String(bare) : stripMarks(text, year);
  return { raw: text, title: title, year: year, season: found.season, episode: found.episode };
}

/** The query is only a year, with optional brackets: "1917" or "(1917)". */
function bareYear(text: string): number {
  const m = /^\s*[\(\[]?\s*((?:19|20)\d\d)\s*[\)\]]?\s*$/.exec(text || '');
  return m ? asYear(m[1]) : 0;
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

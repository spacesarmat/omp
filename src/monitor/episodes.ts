// Season and episode range of a release from its title: «Сезон: 1 / Серии: 1-8 из 10», «S02E01-08», «[02x01-04 из 10]»,
// «1-10 из 10», «1-8 серии из 10», «[S02]», packs «Сезоны 1-3» / «[S01-03]». Chromium 53 safe (no u flag, no lookbehind;
// no \b next to Cyrillic, it is not a word char there).

// «… 2 сезон 1-8 серия», «… 1-8 серии», «… Сезон: 1»: everything from the season / episodes on
export const SEASON_WORDS = /(?:^|[\s.,:;-])(?:(?:\d{1,4}\s*[-–—]\s*)?\d{1,4}\s*(?:-?(?:й|ый|я)\s*)?)?(?:сезон|season|серии|серия|эпизод)[\s\S]*$/i;

export interface EpisodeRange {
  season?: number;
  /** Last season of a pack of seasons («Сезоны 1-3», «[S01-03]»); season is then the first one. */
  seasonTo?: number;
  /** First episode of the release. */
  from?: number;
  /** Last episode of the release. */
  to?: number;
  /** Episodes in the season («из 10»). */
  total?: number;
}

const D = '[-–—]';
const OF = '(?:\\s*(?:из|of)\\s*(\\d{1,4}))?';
const EPISODE_WORD = '(?:сери[ияй]|эпизод\\S*|episodes?)';

// S02E01-08, S02E01-E08, S01E01-S01E10, S03E05
const SXE = new RegExp('(?:^|[^a-z0-9])s(\\d{1,2})[ ._]?e(\\d{1,4})(?:\\s*' + D + '\\s*(?:s\\d{1,2})?e?(\\d{1,4}))?' + OF, 'i');
// 02x01-04 из 10, 03х01-08 (Cyrillic х), 02x13 из 13; the episode has 2+ digits, so the studio «2x2» is not one
const NXN = new RegExp('(?:^|[^0-9a-z])(\\d{1,2})[xх](\\d{2,4})(?:\\s*' + D + '\\s*(\\d{1,4}))?' + OF, 'i');
// Серии: 1-8 из 12, серии 1–10, Серия 5
const NAMED = new RegExp('(?:сери[ия]|эпизод[ыа]?|episodes?)\\s*:?\\s*(\\d{1,4})(?![0-9pр])(?:\\s*' + D + '\\s*(\\d{1,4}))?' + OF, 'i');
// 1-8 серии из 10, 1-10 серия
const RANGE_WORD = new RegExp('(?:^|[^0-9])(\\d{1,4})\\s*' + D + '\\s*(\\d{1,4})\\s*' + EPISODE_WORD + OF, 'i');
// 5 серия (a count «3 серии» / «24 серии» is not an episode: the plural counts only with «из N»)
const ONE_WORD = new RegExp('(?:^|[^0-9\\-–—])(\\d{1,4})\\s*(?:-?я\\s*)?(?:серия|сери[ий](?=\\s*(?:из|of)\\s*\\d))' + OF, 'i');
// 1-10 из 10, [01-02 из 02]
const BARE = new RegExp('(?:^|[^0-9])(\\d{1,4})\\s*' + D + '\\s*(\\d{1,4})\\s*(?:из|of)\\s*(\\d{1,4})', 'i');
// E01-E08
const E_RANGE = new RegExp('(?:^|[^a-z0-9])e(\\d{1,4})\\s*' + D + '\\s*e?(\\d{1,4})' + OF, 'i');
// [01-02]
const BRACKET = new RegExp('\\[\\s*(\\d{1,3})\\s*' + D + '\\s*(\\d{1,3})\\s*\\]');

// packs: «Сезон(ы) 1-3» (not «сезон: 1-8 серии»), «1-3 сезоны», «Season 1-3», «S01-S03», «[S01-03]»
const PACK_WORD = new RegExp(
  '(?:сезон[ыа]?|seasons?)\\s*:?\\s*(\\d{1,2})\\s*' + D + '\\s*(\\d{1,2})(?![0-9])(?!\\s*(?:сери|эпизод|episod))',
  'i',
);
const PACK_AFTER = new RegExp('(?:^|[^0-9])(\\d{1,2})\\s*' + D + '\\s*(\\d{1,2})\\s*(?:-?(?:й|ый)\\s*)?сезон', 'i');
const PACK_S = new RegExp('(?:^|[^a-z0-9])s(\\d{1,2})\\s*' + D + '\\s*s?(\\d{1,2})(?=[^a-z0-9]|$)', 'i');

// «Сезон: 2», not the episodes of «2 сезон 1-8 серия»
const SEASON_WORD = new RegExp('(?:сезон|season)\\s*:?\\s*(\\d{1,2})(?![0-9])(?!\\s*' + D + ')', 'i');
const SEASON_AFTER = /(?:^|[^0-9])(\d{1,2})\s*(?:-?(?:й|ый)\s*)?сезон/i;
const SEASON_S = /(?:^|[^a-z0-9])s(\d{1,2})(?=[^a-z0-9]|$)/i;

// [pattern, has a «to» group]: tried in order until one gives a range
const RANGES: [RegExp, boolean][] = [
  [NAMED, true],
  [RANGE_WORD, true],
  [ONE_WORD, false],
  [BARE, true],
  [E_RANGE, true],
  [BRACKET, true],
];

function n(v: string | undefined): number | undefined {
  return v === undefined || v === '' ? undefined : parseInt(v, 10);
}

function setRange(out: EpisodeRange, from: number | undefined, to: number | undefined, total: number | undefined): boolean {
  if (from === undefined) return false;
  const last = to === undefined ? from : to;
  if (last < from) return false;
  out.from = from;
  out.to = last;
  if (total !== undefined && total >= last) out.total = total;
  return true;
}

/** Season (or a pack of seasons) and episode range from a release title; {} when the title has none. */
export function parseEpisodeRange(title: string): EpisodeRange {
  const t = title || '';
  const out: EpisodeRange = {};
  let m = SXE.exec(t);
  if (m && setRange(out, n(m[2]), n(m[3]), n(m[4]))) out.season = n(m[1]);
  if (out.to === undefined) {
    m = NXN.exec(t);
    if (m && setRange(out, n(m[2]), n(m[3]), n(m[4]))) out.season = n(m[1]);
  }
  for (let i = 0; i < RANGES.length && out.to === undefined; i++) {
    m = RANGES[i][0].exec(t);
    if (!m) continue;
    if (RANGES[i][1]) setRange(out, n(m[1]), n(m[2]), n(m[3]));
    else setRange(out, n(m[1]), undefined, n(m[2]));
  }
  if (out.season === undefined) {
    m = PACK_WORD.exec(t) || PACK_AFTER.exec(t) || PACK_S.exec(t);
    if (m && n(m[2])! > n(m[1])!) {
      out.season = n(m[1]);
      out.seasonTo = n(m[2]);
    }
  }
  if (out.season === undefined) {
    m = SEASON_WORD.exec(t) || SEASON_AFTER.exec(t) || SEASON_S.exec(t);
    if (m) out.season = n(m[1]);
  }
  return out;
}

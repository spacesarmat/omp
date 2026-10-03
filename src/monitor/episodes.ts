// Season and episode range of a release from its title: «Сезон: 1 / Серии: 1-8 из 10», «S02E01-08», «[02x01-04 из 10]»,
// «1-10 из 10», «[S02]». Chromium 53 safe (no u flag, no lookbehind; no \b next to Cyrillic, it is not a word char there).

export interface EpisodeRange {
  season?: number;
  /** First episode of the release. */
  from?: number;
  /** Last episode of the release. */
  to?: number;
  /** Episodes in the season («из 10»). */
  total?: number;
}

const D = '[-–—]';
const OF = '(?:\\s*(?:из|of)\\s*(\\d{1,4}))?';

// S02E01-08, S02E01-E08, S03E05
const SXE = new RegExp('(?:^|[^a-z0-9])s(\\d{1,2})[ ._]?e(\\d{1,4})(?:\\s*' + D + '\\s*e?(\\d{1,4}))?' + OF, 'i');
// 02x01-04 из 10, 03х01-08 (Cyrillic х), 02x13 из 13
const NXN = new RegExp('(?:^|[^0-9a-z])(\\d{1,2})[xх](\\d{1,4})(?:\\s*' + D + '\\s*(\\d{1,4}))?' + OF, 'i');
// Серии: 1-8 из 12, серии 1–10, Серия 5
const NAMED = new RegExp('(?:сери[ияй]|эпизод[ыа]?|episodes?)\\s*:?\\s*(\\d{1,4})(?:\\s*' + D + '\\s*(\\d{1,4}))?' + OF, 'i');
// 1-10 из 10, [01-02 из 02]
const BARE = new RegExp('(?:^|[^0-9])(\\d{1,4})\\s*' + D + '\\s*(\\d{1,4})\\s*(?:из|of)\\s*(\\d{1,4})', 'i');
// [01-02]
const BRACKET = new RegExp('\\[\\s*(\\d{1,3})\\s*' + D + '\\s*(\\d{1,3})\\s*\\]');

const SEASON_WORD = /(?:сезон|season)\s*:?\s*(\d{1,2})/i;
const SEASON_AFTER = /(?:^|[^0-9])(\d{1,2})\s*(?:-?(?:й|ый)\s*)?сезон/i;
const SEASON_S = new RegExp('(?:^|[^a-z0-9])s(\\d{1,2})(?:\\s*' + D + '\\s*s?(\\d{1,2}))?(?=[^a-z0-9]|$)', 'i');

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

/** Season and episode range from a release title; {} when the title has none. */
export function parseEpisodeRange(title: string): EpisodeRange {
  const t = title || '';
  const out: EpisodeRange = {};
  let m = SXE.exec(t);
  if (m && setRange(out, n(m[2]), n(m[3]), n(m[4]))) out.season = n(m[1]);
  if (out.to === undefined) {
    m = NXN.exec(t);
    if (m && setRange(out, n(m[2]), n(m[3]), n(m[4]))) out.season = n(m[1]);
  }
  if (out.to === undefined) {
    m = NAMED.exec(t);
    if (m) setRange(out, n(m[1]), n(m[2]), n(m[3]));
  }
  if (out.to === undefined) {
    m = BARE.exec(t);
    if (m) setRange(out, n(m[1]), n(m[2]), n(m[3]));
  }
  if (out.to === undefined) {
    m = BRACKET.exec(t);
    if (m) setRange(out, n(m[1]), n(m[2]), undefined);
  }
  if (out.season === undefined) {
    m = SEASON_WORD.exec(t) || SEASON_AFTER.exec(t);
    if (m) out.season = n(m[1]);
    else {
      m = SEASON_S.exec(t);
      // [S01-02]: a pack of seasons — the last one counts
      if (m) out.season = n(m[2] || m[1]);
    }
  }
  return out;
}

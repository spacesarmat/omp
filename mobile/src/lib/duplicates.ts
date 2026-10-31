// Several releases of one thing in «Мои» — INFORMATION ONLY: the series screen lists a season's releases with their
// quality, episode (or file) count and size, and an add of a release that is already there says so in a toast.
// Nothing is ever deleted from here: the user deletes by hand from the release's menu, with its usual confirm.
import type { Torrent } from '../../../src/api/types';
import { qualityLabel } from '../../../src/monitor/quality';
import { libraryKey } from '../../../src/catalog/library';
import { titleCore } from '../../../src/lib/posterSearch';
import { displayTitle } from '../../../src/lib/torrentName';
import { shortTitle } from '../../../src/lib/libraryView';
import { contentsText, extrasText } from './releaseContents';
import { torrents } from '../../../src/store/library';
import { fmtSize, t } from '../../../src/i18n';
import { joinMeta } from '../../../src/lib/torrentStatus';
import { groupLibrary, isSeries, seasonMembers, type SeriesGroup } from '../../../src/lib/seriesGroups';
import { cachedMovieId } from '../../../src/lib/useMovieCard';

export { contentsText };

/** A release named for its menu: «Повелитель духов · 4K WEB-DL» (the series name, then the release's quality). */
export function releaseName(tor: Torrent, name: string): string {
  const own = shortTitle(displayTitle(tor));
  return [name || own, qualityLabel(displayTitle(tor))].filter(Boolean).join(' · ');
}

/** «4K WEB-DL · 18 серий · +3 озвучки, субтитры · 9,7 ГБ» (the parts known). */
export function releaseLine(tor: Torrent, withContents = true, withExtras = true): string {
  return joinMeta([
    qualityLabel(displayTitle(tor)) || shortTitle(displayTitle(tor)),
    withContents ? contentsText(tor) : '',
    withExtras ? extrasText(tor) : '',
    tor.torrent_size ? fmtSize(tor.torrent_size) : '',
  ]);
}

/**
 * Words of a «Name / Name / 2026 / ДБ, СТ / 4K, HEVC, HDR / Blu-Ray Remux» part that are about the release, not the
 * film: video, source, sound and translation tags. A part made only of these (and numbers) is not a title.
 */
const TECH_WORDS = new Set(
  (
    '4k uhd fhd hd sd hdr hdr10 hdr10+ sdr dv dovi dolby vision atmos imax hevc avc h264 h265 x264 x265 av1 vp9 10bit 8bit ' +
    'remux bdremux bdrip blu ray bluray blu-ray web dl web-dl webdl webrip web-rip hdrip dvdrip dvd dvd5 dvd9 hdtv hdtvrip tvrip camrip ' +
    'ts tc cam mkv mp4 avi hybrid ' +
    'дб пд пм по ап ст лм ло мво дво аво ммво сабы суб sub subs rus eng ukr ориг оригинал original dub mvo dvo avo vo ' +
    'дубляж многоголосый двухголосый одноголосый авторский профессиональный любительский лицензия itunes netflix amzn ma'
  ).split(' '),
);

function techWord(w: string): boolean {
  return TECH_WORDS.has(w) || /^\d+$/.test(w) || /^\d{3,4}[pi]$/.test(w) || /^p\d$/.test(w) || /^hdr\d*\+?$/.test(w) || /^\d+x$/.test(w) || w === 'x';
}

/** A slash part that names the release, not the film: a bare year, or only tags and numbers («4 x ДБ, ПМ, СТ», «WEB-DL»). */
export function isTechPart(part: string): boolean {
  const words = part
    .toLowerCase()
    .split(/[\s,;:+|()\[\]]+/)
    .filter(Boolean);
  if (!words.length) return true;
  if (!/[a-zа-яё]/i.test(part)) return true;
  // «Сезон: 5», «Серии: 1-22 из 22», «S4E1-8 of 8»: a season or episode range is not a name either
  if (/^\s*(?:(?:сезон|серии|серия|season|episodes?)\s*:?\s*\d|s\d+e\d+|s\d+\b|e\d+\s+of)/i.test(part)) return true;
  return words.every(techWord);
}

/**
 * The title and year keys of a film: the names before the first « (» or « [», with the release year; none without a
 * year. In «Супергерл / Supergirl / 2026 / ДБ, СТ / 4K ... / Blu-Ray Remux» only the parts before the bare year are
 * names, and tag-only parts never are: otherwise «2026|2026» or «blu ray remux|2026» made different films one.
 */
export function filmKeys(tor: Torrent): string[] {
  const raw = displayTitle(tor);
  const field = /[\[(](?:[^\])]*[^0-9\])])?((?:19|20)\d\d)(?![0-9])/.exec(raw);
  const any = field ? null : /(?:^|[^0-9x])((?:19|20)\d\d)(?![0-9xp])/i.exec(raw);
  const year = field ? +field[1] : any ? +any[1] : 0;
  if (!year) return [];
  let head = raw;
  [' (', ' ['].forEach((sep) => {
    const at = head.indexOf(sep);
    if (at > 0) head = head.slice(0, at);
  });
  const out: string[] = [];
  const parts = head.split(' / ');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // «… / 2026 / …»: the names end at the year
    if (i > 0 && /^\s*(?:19|20)\d\d\s*$/.test(part)) break;
    const core = titleCore(part);
    // the first part is always the name, even when it looks like a tag or a number («Cam (2018)», «1917 / 1917»);
    // later parts that are only tags, numbers or a season range are about the release
    if (!core || (i > 0 && (isTechPart(part) || isTechPart(core)))) continue;
    const k = libraryKey(core, year);
    if (k && out.indexOf(k) < 0) out.push(k);
  }
  return out;
}

/** Both films matched to TMDB, to different films: never one film, whatever the names say. */
export function differentMovies(a: Torrent, b: Torrent): boolean {
  const x = cachedMovieId(a.hash);
  const y = cachedMovieId(b.hash);
  return !!x && !!y && x !== y;
}

function groupOf(list: Torrent[], tor: Torrent): SeriesGroup | null {
  const items = groupLibrary(list);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'series' && it.members.indexOf(tor) >= 0) return it;
  }
  return null;
}

/** The other releases of the same thing: a series release of the same season, or a film with the same title and year. */
export function sameReleases(list: Torrent[], tor: Torrent): Torrent[] {
  const key = tor.hash.toLowerCase();
  const others = list.filter((x) => x.hash.toLowerCase() !== key);
  if (isSeries(tor)) {
    const g = groupOf(others.concat([tor]), tor);
    if (!g) return [];
    const out: Torrent[] = [];
    g.seasons.forEach((s) => {
      const here = seasonMembers(g, s);
      if (here.indexOf(tor) < 0) return;
      here.forEach((m) => {
        if (m !== tor && out.indexOf(m) < 0) out.push(m);
      });
    });
    return out;
  }
  const keys = filmKeys(tor);
  if (!keys.length) return [];
  return others.filter((x) => !isSeries(x) && !differentMovies(x, tor) && filmKeys(x).some((k) => keys.indexOf(k) >= 0));
}

/** After an add: the toast text when the library already has this release («Такая раздача уже есть: 4K · 9,7 ГБ»); '' otherwise. */
export function alreadyHaveText(hash: string, title: string, category?: string): string {
  const list = torrents.peek();
  const fresh = list.filter((x) => x.hash.toLowerCase() === hash.toLowerCase())[0] || ({ hash, title, category: category || '' } as Torrent);
  const same = sameReleases(list.indexOf(fresh) >= 0 ? list : list.concat([fresh]), fresh);
  return same.length ? t('series.alreadyHave', { info: releaseLine(same[0], false) }) : '';
}

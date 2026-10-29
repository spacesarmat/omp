// The words of «Найти в лучшем качестве» shared by the phone sheet and the TV dialog: the quality of a release, the
// seasons a series candidate covers, and why a replace failed. Chromium 53 safe.
import { t, tp } from '../i18n';
import { sourceName } from '../sources/view';
import type { SourceResult } from '../sources/types';
import type { LibraryTorrent } from './newEpisodes';
import { qualityLabel } from './quality';
import type { ReplaceResult } from './replace';
import { seasonsCovered, upgradeKind } from './upgrade';
import { parseEpisodeRange } from './episodes';

/** «1080p WEB-DL», or «качество не указано». */
export function qualityOrUnknown(title: string): string {
  return qualityLabel(title) || t('torrent.better.unknown');
}

/** «сезоны 1-3» / «все сезоны» when a series candidate holds more than the torrent's season. */
export function coverageNote(lib: LibraryTorrent, r: SourceResult): string {
  const s = seasonsCovered(lib, r);
  if (!s) return '';
  return 'all' in s ? t('torrent.better.allSeasons') : t('torrent.better.seasons', { from: s.from, to: s.to });
}

/**
 * What a series candidate holds, from its title: «S01 · 8 серий», «S01 · серии 1-6 из 8», «S01». '' for a film, a pack
 * of seasons (coverageNote says it) or a title without a season.
 */
export function episodesNote(lib: LibraryTorrent, r: Pick<SourceResult, 'Title'>): string {
  if (upgradeKind(lib) !== 'series') return '';
  const range = parseEpisodeRange(r.Title || '');
  if (range.season === undefined || range.seasonTo !== undefined) return '';
  const code = 'S' + (range.season < 10 ? '0' : '') + range.season;
  if (range.to === undefined) return code;
  const from = range.from === undefined ? 1 : range.from;
  if (range.total !== undefined && (from > 1 || range.to < range.total)) {
    return code + ' · ' + t('torrent.better.episodesOf', { from, to: range.to, total: range.total });
  }
  return code + ' · ' + tp('library.episodes', range.to - from + 1);
}

export interface Failure {
  text: string;
  /** The site to sign in to («Войти»), only when the tracker asked for a login. */
  source?: string;
}

/** The text for a failed replace: what went wrong, and that the user's torrent is untouched. */
export function failureOf(res: Extract<ReplaceResult, { ok: false }>, r: SourceResult): Failure {
  if (res.cause === 'timeout') return { text: t('torrent.better.failTimeout') };
  if (res.cause === 'login') {
    return { text: t('torrent.better.failLogin', { site: sourceName(r.source) }), source: r.source };
  }
  // The tracker answered, but the download was not a torrent file. No «Войти»: a login will not fetch it.
  if (res.cause === 'link') {
    return { text: t('torrent.better.failLink', { site: sourceName(r.source) }) };
  }
  // both torrents are kept: the message says so itself
  if (res.cause === 'both') return { text: res.error };
  return { text: [res.error, t('torrent.better.untouched')].filter(Boolean).join(' ') };
}

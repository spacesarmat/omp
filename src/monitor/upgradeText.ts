// The words of «Найти в лучшем качестве» shared by the phone sheet and the TV dialog: the quality of a release, the
// seasons a series candidate covers, and why a replace failed. Chromium 53 safe.
import { t } from '../i18n';
import { sourceName } from '../sources/view';
import type { SourceResult } from '../sources/types';
import type { LibraryTorrent } from './newEpisodes';
import { qualityLabel } from './quality';
import type { ReplaceResult } from './replace';
import { seasonsCovered } from './upgrade';

/** «1080p WEB-DL», or «качество не указано». */
export function qualityOrUnknown(title: string): string {
  return qualityLabel(title) || t('torrent.better.unknown');
}

/** «сезоны 1–3» / «все сезоны» when a series candidate holds more than the torrent's season. */
export function coverageNote(lib: LibraryTorrent, r: SourceResult): string {
  const s = seasonsCovered(lib, r);
  if (!s) return '';
  return 'all' in s ? t('torrent.better.allSeasons') : t('torrent.better.seasons', { from: s.from, to: s.to });
}

export interface Failure {
  text: string;
  /** The site to sign in to («Войти»), for a login / link failure. */
  source?: string;
}

/** The text for a failed replace: what went wrong, and that the user's torrent is untouched. */
export function failureOf(res: Extract<ReplaceResult, { ok: false }>, r: SourceResult): Failure {
  if (res.cause === 'timeout') return { text: t('torrent.better.failTimeout') };
  if (res.cause === 'login' || res.cause === 'link') {
    return { text: t('torrent.better.failLogin', { site: sourceName(r.source) }), source: r.source };
  }
  // both torrents are kept: the message says so itself
  if (res.cause === 'both') return { text: res.error };
  return { text: [res.error, t('torrent.better.untouched')].filter(Boolean).join(' ') };
}

// Words put into a share. Title, year, one short line, then the link. No magnets and no hashes.
import { t, tp, fmtDuration } from '../../../src/i18n';
import { airDateText } from '../../../src/lib/seriesStatus';
import { shareMessageText, titleUrl, SHARE_ORIGIN, type TitleRef } from '../../../src/lib/shareLink';
import type { CatalogCard, Season } from '../../../src/catalog/tmdb';
import { seriesDates, seriesStatusWord } from '../screens/catalog/TitleCard';

export interface SharePayload {
  text: string;
  subject: string;
}

function payload(title: string, year: number, line: string, url: string): SharePayload {
  return { subject: title || 'OMP', text: shareMessageText(title, year, line, url) };
}

function filmLine(card: CatalogCard): string {
  const genres = card.genres.slice(0, 2).join(', ');
  const dur = card.runtime > 0 ? fmtDuration(card.runtime) : '';
  return [genres, dur].filter(Boolean).join(' · ') || t('library.movie');
}

function seriesLine(card: CatalogCard): string {
  return [seriesDates(card), seriesStatusWord(card)].filter(Boolean).join(' · ') || t('discover.series');
}

/** Title card: the series or the film, not one season. */
export function cardShare(card: CatalogCard): SharePayload {
  const url = titleUrl({ kind: card.kind, id: card.id });
  const line = card.kind === 'tv' ? seriesLine(card) : filmLine(card);
  return payload(card.title, card.year, line, url);
}

/** Season page. An unreleased season with a date says «Сезон N выходит 8 нояб.». */
export function seasonShareLine(n: number, meta: Season): string {
  if (meta.aired === 0) {
    const when = meta.airDate ? airDateText(meta.airDate) : '';
    if (when) return t('share.seasonOut', { n: n, date: when });
  }
  const eps = meta.episodes > 0 ? tp('library.episodes', meta.episodes) : '';
  return [t('library.season', { n: n }), eps].filter(Boolean).join(' · ');
}

export function seasonShare(card: CatalogCard, n: number, meta: Season): SharePayload {
  const ref: TitleRef = { kind: 'tv', id: card.id, season: n };
  return payload(card.title, meta.year || card.year, seasonShareLine(n, meta), titleUrl(ref));
}

/** A poster in the catalog or in «Хочу»: the title, the year and «Фильм» or «Сериал». */
export function posterShare(item: { kind: 'movie' | 'tv'; id: number; title: string; year: number }): SharePayload {
  const url = titleUrl({ kind: item.kind, id: item.id });
  const line = item.kind === 'tv' ? t('discover.series') : t('library.movie');
  return payload(item.title, item.year, line, url);
}

/** «Рассказать друзьям»: the site, nothing else. */
export function friendsShare(): SharePayload {
  return payload(t('share.friendsText'), 0, '', SHARE_ORIGIN);
}

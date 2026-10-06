// A series' state from its TMDB card: the status pill («Выходит · следующая серия 12 окт.», «Завершён», «Отменён»,
// «В производстве», «Скоро новый сезон»), the seasons still to come and the small badge of a «Мои» tile.
// Cards cached before these fields existed have none of them: unknown, so no pill and no badge from them.
import { fmtDay, t } from '../i18n';
import type { CatalogCard } from '../catalog/tmdb';

export type PillTone = 'airing' | 'ended' | 'canceled' | 'soon';
export interface StatusPill { tone: PillTone; text: string; }
export interface Upcoming { number: number; airDate: string; }

const DAY_MS = 24 * 60 * 60 * 1000;
/** «новая серия …» on a tile: the next episode at most this many days ahead. */
export const BADGE_DAYS = 30;

function pad(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** The local day of `now` as 'YYYY-MM-DD' (TMDB's air dates compare as strings). */
export function isoDay(now: number): string {
  const d = new Date(now);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function localDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** «8 авг.»; with the year when it is not this year. The local date of a TMDB 'YYYY-MM-DD'; '' for anything else. */
export function airDateText(iso: string, now: number = Date.now()): string {
  const d = localDate(iso);
  if (!d) return '';
  return fmtDay(d.getTime(), now);
}

/** Whole days from today to `iso` (negative in the past); NaN for a bad date. */
function daysUntil(iso: string, now: number): number {
  const d = localDate(iso);
  const today = localDate(isoDay(now));
  if (!d || !today) return NaN;
  return Math.round((d.getTime() - today.getTime()) / DAY_MS);
}

/** The next episode when it is dated today or later; null when unknown or stale. */
function upcomingEpisode(card: CatalogCard, now: number) {
  const ne = card.nextEpisode;
  return ne && ne.airDate && ne.airDate >= isoDay(now) ? ne : null;
}

/**
 * The seasons still to come, ascending: those dated after today, and the next episode's season when it has not
 * started yet (TMDB may not list it yet). Each with the day it starts.
 */
export function upcomingSeasons(card: CatalogCard, now: number = Date.now()): Upcoming[] {
  if (card.kind !== 'tv') return [];
  const today = isoDay(now);
  const out: Upcoming[] = [];
  card.seasons.forEach((s) => {
    if (s.airDate && s.airDate > today) out.push({ number: s.number, airDate: s.airDate });
  });
  const ne = upcomingEpisode(card, now);
  if (ne && !out.some((u) => u.number === ne.season)) {
    const s = card.seasons.filter((x) => x.number === ne.season)[0];
    const started = !!s && (s.aired > 0 || (!!s.airDate && s.airDate <= today));
    if (!started) out.push({ number: ne.season, airDate: ne.airDate });
  }
  return out.sort((a, b) => a.number - b.number);
}

/** The status pill of a series; null for a film or when nothing is known. */
export function seriesPill(card: CatalogCard, now: number = Date.now()): StatusPill | null {
  if (card.kind !== 'tv') return null;
  const status = card.status || '';
  if (status === 'canceled') return { tone: 'canceled', text: t('series.statusCanceled') };
  if (status === 'ended') return { tone: 'ended', text: t('series.statusEnded') };
  if (status === 'production' || status === 'planned') return { tone: 'soon', text: t('series.statusProduction') };
  const next = upcomingEpisode(card, now);
  if (next) return { tone: 'airing', text: t('series.statusAiring') + ' · ' + t('series.nextEpisode', { date: airDateText(next.airDate, now) }) };
  if (upcomingSeasons(card, now).length) return { tone: 'soon', text: t('series.statusSoon') };
  if (status === 'returning') return { tone: 'airing', text: t('series.statusAiring') };
  return null;
}

/**
 * The badge of a «Мои» tile: «новая серия 12 окт.» when the next episode is within 30 days, else «новый сезон» when TMDB
 * has a released season newer than the newest one of the library; '' otherwise.
 */
export function tileBadge(card: CatalogCard, librarySeasons: number[], now: number = Date.now()): string {
  if (card.kind !== 'tv') return '';
  const ne = upcomingEpisode(card, now);
  if (ne) {
    const days = daysUntil(ne.airDate, now);
    if (days >= 0 && days <= BADGE_DAYS) return t('series.badgeNext', { date: airDateText(ne.airDate, now) });
  }
  const newest = librarySeasons.reduce((m, s) => Math.max(m, s), 0);
  if (!newest) return '';
  const today = isoDay(now);
  const released = card.seasons.some((s) => s.number > newest && (s.aired > 0 || (!!s.airDate && s.airDate <= today)));
  return released ? t('series.badgeSeason') : '';
}

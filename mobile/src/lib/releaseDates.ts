// Release dates on the phone: the small label of a «Обзор» tile («в цифре 12 нояб.», «в кино с 3 окт.», «новая серия
// 8 окт.», «2 сезон — 15 нояб.»), the release line of a film card («Кино: 3 окт. · Цифра: 12 нояб.»), the next
// episodes of a series card and the day headers of the calendar («Сегодня», «Завтра», «Ср 8 окт.»).
// Dates are TMDB's 'YYYY-MM-DD', compared as strings with the local today.
import { t } from '../../../src/i18n';
import { addDays } from '../../../src/catalog/discoverQuery';
import type { CatalogCard, SeasonDetails } from '../../../src/catalog/tmdb';
import { airDateText, isoDay, upcomingSeasons, BADGE_DAYS } from './seriesStatus';

/** «в кино с …»: a theatrical release at most this many days ago, while the film has no digital one yet. */
export const CINEMA_DAYS = 60;

/** «S02E07». */
export function episodeCode(season: number, episode: number): string {
  const two = (n: number) => (n < 10 ? '0' : '') + n;
  return 'S' + two(season) + 'E' + two(episode);
}

/** The label of a «Обзор» tile from the title's card; '' when there is nothing to tell. */
export function tileLabel(card: CatalogCard, now: number = Date.now()): string {
  const today = isoDay(now);
  if (card.kind === 'movie') {
    const r = card.releases;
    if (!r) return '';
    if (r.digital && r.digital > today) return t('discover.tileDigital', { date: airDateText(r.digital, now) });
    if (!r.digital && r.theatrical && r.theatrical <= today && r.theatrical >= addDays(today, -CINEMA_DAYS)) {
      return t('discover.tileCinema', { date: airDateText(r.theatrical, now) });
    }
    return '';
  }
  const ne = card.nextEpisode;
  const soon = ne && ne.airDate && ne.airDate >= today && ne.airDate <= addDays(today, BADGE_DAYS) ? ne : null;
  const seasons = upcomingSeasons(card, now);
  if (soon) {
    // the premiere of a season not started yet reads as the season
    const premiere = soon.episode === 1 && seasons.some((s) => s.number === soon.season);
    if (premiere) return t('discover.tileSeason', { n: soon.season, date: airDateText(soon.airDate, now) });
    return t('discover.tileEpisode', { date: airDateText(soon.airDate, now) });
  }
  const next = seasons.filter((s) => !!s.airDate)[0];
  return next ? t('discover.tileSeason', { n: next.number, date: airDateText(next.airDate, now) }) : '';
}

export interface ReleasePart { text: string; future: boolean; }

/** A film card's release line, the known dates only: cinemas, digital, disc. */
export function releaseParts(card: CatalogCard, now: number = Date.now()): ReleasePart[] {
  const r = card.kind === 'movie' ? card.releases : undefined;
  if (!r) return [];
  const today = isoDay(now);
  const out: ReleasePart[] = [];
  const add = (iso: string | undefined, key: 'titleCard.releaseCinema' | 'titleCard.releaseDigital' | 'titleCard.releaseDisc') => {
    const date = iso ? airDateText(iso, now) : '';
    if (date) out.push({ text: t(key, { date: date }), future: (iso as string) > today });
  };
  add(r.theatrical, 'titleCard.releaseCinema');
  add(r.digital, 'titleCard.releaseDigital');
  add(r.physical, 'titleCard.releaseDisc');
  return out;
}

export interface UpcomingEpisode { season: number; episode: number; title: string; airDate: string; }

/** The seasons whose episodes tell the next ones: the next episode's season, else the first season to come. */
export function nextEpisodeSeasons(card: CatalogCard, now: number = Date.now()): number[] {
  if (card.kind !== 'tv') return [];
  const ne = card.nextEpisode;
  if (ne && ne.airDate && ne.airDate >= isoDay(now)) return [ne.season];
  const next = upcomingSeasons(card, now)[0];
  return next ? [next.number] : ne ? [ne.season] : [];
}

/**
 * The next dated episodes (today or later), soonest first, at most `max`; the card's next episode alone when the
 * season data has none of them (not loaded, or failed).
 */
export function upcomingEpisodes(card: CatalogCard, seasons: SeasonDetails[], now: number = Date.now(), max = 3): UpcomingEpisode[] {
  const today = isoDay(now);
  const out: UpcomingEpisode[] = [];
  seasons.forEach((s) => {
    s.episodes.forEach((e) => {
      if (e.airDate && e.airDate >= today) out.push({ season: s.number, episode: e.n, title: e.title, airDate: e.airDate });
    });
  });
  out.sort((a, b) => (a.airDate < b.airDate ? -1 : a.airDate > b.airDate ? 1 : a.season - b.season || a.episode - b.episode));
  const ne = card.nextEpisode;
  if (!out.length && ne && ne.airDate && ne.airDate >= today) out.push({ season: ne.season, episode: ne.episode, title: '', airDate: ne.airDate });
  return out.slice(0, max);
}

/** A day header of the calendar: «Сегодня», «Завтра», «Вчера», else «Ср 8 окт.». */
export function dayHeader(iso: string, now: number = Date.now()): string {
  const today = isoDay(now);
  if (iso === today) return t('date.today');
  if (iso === addDays(today, 1)) return t('date.tomorrow');
  if (iso === addDays(today, -1)) return t('date.yesterday');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const wd = t('date.weekdays').split(' ')[new Date(+m[1], +m[2] - 1, +m[3]).getDay()];
  return t('date.weekdayDay', { wd: wd, day: airDateText(iso, now) });
}

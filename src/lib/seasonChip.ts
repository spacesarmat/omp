// The sub-line of a season chip: what is there to watch first, then how much of it is watched — «10 серий · смотрели 1»,
// «6 из 10 серий · смотрели 1» (TMDB lists more than the release has), «10 серий», «10 серий · ✓ просмотрено» (the TV draws the check as its icon: the font lacks ✓).
// «1 из 10» alone read as «one episode out», so the counts come with their noun.
import { t, tp } from '../i18n';

export interface SeasonChipSub {
  /** «10 серий», «6 из 10 серий». */
  episodes: string;
  /** «смотрели 1», «просмотрено» (every episode: `all`), '' for none watched. */
  watched: string;
  all: boolean;
}

/**
 * have: the episodes of the release(s) here; total: the season's episode count on TMDB (0 when unknown); done: the
 * watched ones among `have`.
 */
export function seasonChipSub(have: number, total: number, done: number): SeasonChipSub {
  const episodes = total > have ? tp('series.episodesOf', total, { have }) : tp('library.episodes', have);
  const all = have > 0 && done >= have;
  const watched = all ? t('series.watchedEvery') : done > 0 ? t('series.watchedSome', { n: done }) : '';
  return { episodes, watched, all };
}

// The torrent screen's TMDB episode names: the show of a series torrent is matched once per torrent (in memory),
// its seasons are read through the cached, language-aware catalog client. Every failure means «no names»: the screen
// then shows what it showed before.
import type { Torrent } from '../../../src/api/types';
import type { CatalogCard, Episode, SeasonDetails } from '../../../src/catalog/tmdb';
import { yearOf } from '../../../src/monitor/newEpisodes';
import { findShow } from './tmdbShow';
import { displayTitle } from '../../../src/lib/torrentName';
import { phoneCatalog } from '../catalog/phoneCatalog';

export interface ShowInfo {
  id: number;
  title: string;
  original: string;
  year: number;
  /** The season numbers TMDB lists (no specials). */
  seasons: number[];
}

const shows = new Map<string, Promise<ShowInfo | null>>();

/** Forget the matched shows (tests). */
export function resetEpisodeNames(): void {
  shows.clear();
}


async function match(tor: Torrent): Promise<ShowInfo | null> {
  const title = tor.title || displayTitle(tor);
  const c = await phoneCatalog();
  const item = await findShow(c, title, yearOf(title) || 0);
  if (!item) return null;
  const hit = item;
  let card: CatalogCard | null = null;
  try {
    card = await c.card('tv', hit.id);
  } catch {
    // the seasons list is a bonus: the names still work
  }
  return {
    id: item.id,
    title: item.title,
    original: item.original,
    year: item.year,
    seasons: card ? card.seasons.map((s) => s.number).filter((n) => n > 0).sort((a, b) => a - b) : [],
  };
}

/** The TMDB show of a torrent, matched once per hash; null when there is none or TMDB is out of reach. */
export function showOf(tor: Torrent): Promise<ShowInfo | null> {
  const key = tor.hash;
  let p = shows.get(key);
  if (!p) {
    p = match(tor).then(
      (s) => s,
      () => {
        // a failure (offline, no key) is not remembered: the next visit asks again
        shows.delete(key);
        return null;
      },
    );
    shows.set(key, p);
  }
  return p;
}

/** The episodes of one season by number; empty when TMDB has none or cannot be reached. */
export async function seasonEpisodes(show: ShowInfo, n: number): Promise<{ [ep: number]: Episode }> {
  try {
    const d: SeasonDetails = await (await phoneCatalog()).season(show.id, n);
    const out: { [ep: number]: Episode } = {};
    d.episodes.forEach((e) => {
      out[e.n] = e;
    });
    return out;
  } catch {
    return {};
  }
}

/** «Эпизод 7», «Episode 7», «Серия 7»: TMDB's stand-in for an episode with no name yet. */
const PLACEHOLDER_NAME = /^(\u044d\u043f\u0438\u0437\u043e\u0434|episode|\u0441\u0435\u0440\u0438\u044f)\s*\d+$/i;

/** The episode's real name: '' for none or a placeholder («Эпизод 7»). */
export function realEpisodeName(name: string): string {
  const n = (name || '').trim();
  return PLACEHOLDER_NAME.test(n) ? '' : n;
}

/** The episodes of a torrent's seasons by number, as TMDB lists them. */
export type EpisodeMap = { [season: number]: { [ep: number]: Episode } };

/** An announced episode the torrent does not have yet (a muted row after its last one). */
export interface ComingEpisode { season: number; episode: number; name: string; airDate: string; }

/**
 * The episodes TMDB announces after the torrent's last one of each season: dated today or later, numbered past the
 * last file of that season, in order. `have`: season → the last episode number among the files.
 */
export function comingEpisodes(have: { [season: number]: number }, eps: EpisodeMap, today: string): ComingEpisode[] {
  const out: ComingEpisode[] = [];
  Object.keys(have)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((s) => {
      const m = eps[s];
      if (!m) return;
      Object.keys(m)
        .map(Number)
        .sort((a, b) => a - b)
        .forEach((n) => {
          const e = m[n];
          if (n > have[s] && e.airDate && e.airDate >= today) out.push({ season: s, episode: n, name: realEpisodeName(e.title), airDate: e.airDate });
        });
    });
  return out;
}

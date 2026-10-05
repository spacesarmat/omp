// The torrent screen's TMDB episode names: the show of a series torrent is matched once per torrent (in memory),
// its seasons are read through the cached, language-aware catalog client. Every failure means «no names»: the screen
// then shows what it showed before.
import type { Torrent } from '../../../src/api/types';
import type { CatalogCard, Episode, SeasonDetails } from '../../../src/catalog/tmdb';
import { seriesQuery, yearOf } from '../../../src/monitor/newEpisodes';
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

function pick(items: { kind: string; id: number; year: number }[], year: number) {
  const tv = items.filter((x) => x.kind === 'tv');
  return (year ? tv.filter((x) => x.year === year)[0] : undefined) || tv[0];
}

async function match(tor: Torrent): Promise<ShowInfo | null> {
  const title = tor.title || displayTitle(tor);
  const q = seriesQuery(title);
  if (!q) return null;
  const c = await phoneCatalog();
  const r = await c.search(q, 1);
  const hit = pick(r.items, yearOf(title) || 0);
  if (!hit) return null;
  const item = r.items.filter((x) => x.id === hit.id && x.kind === 'tv')[0];
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

/** «Star.Trek.S04E01.1080p» as a readable name: dots and underscores to spaces. */
export function cleanFileName(name: string): string {
  return name.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
}

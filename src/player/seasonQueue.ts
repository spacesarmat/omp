// One season, from the episode the person chose, using only files of the current release.
// The next season is never added. A hole in the numbering stops the queue: another torrent is not chosen.
import { fileEpisodes, isFractionalEpisode } from '../lib/categoryCheck';
import { isExtraFile, parseEpisode, playableFiles, type TorrentFile } from '../lib/episodes';

export interface SeasonSpan {
  /** Chosen episode through the last contiguous episode of the same season in this release. */
  files: TorrentFile[];
  /** Index of the chosen file. Always 0 when the file is an episode: earlier ones are left out. */
  start: number;
  /** Null when the episode name has no season and no season folder. */
  season: number | null;
  /** True when the start file is an episode. A film stays false, so its queue is not rebuilt. */
  episodic: boolean;
  /**
   * The next episode number that this release does not have.
   * Null at the end of a contiguous run when no later episode of the season is known
   * (`total` reached, or nothing past the last file and no hole before it).
   */
  missing: number | null;
}

/** Episode numbers, and the season they belong to. A folder season counts when the file name states none. */
function placed(path: string): { season: number | null; episodes: number[] } | null {
  if (isExtraFile(path)) return null;
  // E02.5 is not episode 2. parseEpisode would keep only the digits before the dot.
  if (isFractionalEpisode(path)) return null;
  const info = fileEpisodes(path);
  const parsed = parseEpisode(path);
  const episodes = info && info.episodes.length ? info.episodes.slice() : [];
  // The label on screen («13 серия») comes from parseEpisode. A range parser must not hide that number,
  // or the queue says the episode being played is not in the release.
  if (parsed.episode !== null && episodes.indexOf(parsed.episode) < 0) episodes.push(parsed.episode);
  if (!episodes.length) return null;
  // S01E02 in the name wins over a Season 2 folder. The folder is used only when the name has no season.
  const season = info && info.season !== null ? info.season : parsed.season;
  return { season: season, episodes: episodes };
}

/**
 * `total` is the season's episode count when the catalog knows it.
 * A file that is not an episode (a film) stays a one-item queue and does not constrain the rest.
 */
export function seasonSpan(all: TorrentFile[], startId: number, total?: number): SeasonSpan {
  const playable = playableFiles(all);
  const start = playable.filter((f) => f.id === startId)[0];
  const none = { files: [] as TorrentFile[], start: 0, season: null, episodic: false, missing: null };
  if (!start) return none;
  // A special the person chose stays that one file. It is not a film, so the rest of the release is not played past the gap.
  if (isFractionalEpisode(start.path)) {
    return { files: [start], start: 0, season: parseEpisode(start.path).season, episodic: true, missing: null };
  }
  const startPlace = placed(start.path);
  if (!startPlace) return { files: [start], start: 0, season: null, episodic: false, missing: null };
  const season = startPlace.season;
  const startEps = startPlace.episodes.filter((e) => e > 0);
  const from = startEps.reduce((m, n) => (n < m ? n : m), startEps[0]);
  const covers: { id: number; file: TorrentFile; episodes: number[] }[] = [];
  playable.forEach((f) => {
    const info = placed(f.path);
    if (!info) return;
    const eps = info.episodes.filter((e) => e >= from);
    if (!eps.length) return;
    // A file that names the episode but not the season («13 серия», «E13») still belongs to this season.
    // A file that names a different season does not fill the hole.
    if (info.season !== null && info.season !== season) return;
    covers.push({ id: f.id, file: f, episodes: eps });
  });
  const files: TorrentFile[] = [];
  const used: { [id: number]: boolean } = {};
  let n = from;
  const knownEnd = total !== undefined && total >= from ? total : 0;
  while (!knownEnd || n <= knownEnd) {
    let hit: { id: number; file: TorrentFile; episodes: number[] } | undefined;
    for (let i = 0; i < covers.length; i++) {
      if (covers[i].episodes.indexOf(n) < 0) continue;
      // The file the person chose wins when two copies share an episode number.
      if (covers[i].id === startId) {
        hit = covers[i];
        break;
      }
      if (!hit) hit = covers[i];
    }
    if (!hit) break;
    if (!used[hit.id]) {
      files.push(hit.file);
      used[hit.id] = true;
    }
    // One number at a time. A combined name can skip a number (S01E01E03), and that hole still stops the queue.
    n = n + 1;
    if (n > from + 10000) break;
  }
  let missing: number | null = null;
  const coversN = covers.some((c) => c.episodes.indexOf(n) >= 0);
  if (!coversN) {
    const later = covers.some((c) => c.episodes.some((e) => e > n));
    if (later || (knownEnd && n <= knownEnd)) missing = n;
  }
  // The file that is playing covers this number. It is in the release.
  if (missing !== null && startPlace.episodes.indexOf(missing) >= 0) missing = null;
  return { files: files.length ? files : [start], start: 0, season: season, episodic: true, missing: missing };
}

/** File ids to send to the TV. Undefined when the start file is not an episode, so a film's queue stays as it was. */
export function seasonFileIds(all: TorrentFile[], startId: number, total?: number): number[] | undefined {
  const span = seasonSpan(all, startId, total);
  if (!span.episodic || !span.files.length) return undefined;
  return span.files.map((f) => f.id);
}

export type SeasonStep =
  | { kind: 'stay' }
  | { kind: 'next'; index: number }
  | { kind: 'done'; missing: number | null };

/**
 * What to do when an item reports its end. Cancel and a second end for the same index do not move.
 * `seen` is the index whose end was already consumed.
 */
export function seasonStep(o: {
  length: number;
  index: number;
  ended: boolean;
  cancel: boolean;
  seen: number | null;
  missing: number | null;
}): { step: SeasonStep; seen: number | null } {
  if (o.cancel || !o.ended) return { step: { kind: 'stay' }, seen: o.seen };
  if (o.seen === o.index) return { step: { kind: 'stay' }, seen: o.seen };
  const seen = o.index;
  if (o.index + 1 < o.length) return { step: { kind: 'next', index: o.index + 1 }, seen: seen };
  return { step: { kind: 'done', missing: o.missing }, seen: seen };
}

/** One visit to a queue item on the TV player. A new index starts a fresh visit, so going back can advance again. */
export interface SeasonVisit {
  index: number;
  ended: number;
  advanced: boolean;
}

export function seasonVisit(
  prev: SeasonVisit,
  index: number,
  ended: number,
  hasNext: boolean,
): { state: SeasonVisit; go: 'stay' | 'next' | 'end' } {
  if (index !== prev.index) return { state: { index, ended, advanced: false }, go: 'stay' };
  if (!ended || ended === prev.ended) return { state: prev, go: 'stay' };
  if (prev.advanced) return { state: { index, ended, advanced: true }, go: 'stay' };
  return { state: { index, ended, advanced: true }, go: hasNext ? 'next' : 'end' };
}

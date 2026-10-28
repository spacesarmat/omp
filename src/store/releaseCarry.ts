// The trash on a release in «Раздачи» (phone and TV): before a release of a season (or of a film) is removed, what was
// watched in it goes to a release that stays. The watch journal (omp.h) is moved with the files matched by episode
// (mapFiles / mapJournal of «Заменить»), the intro skip settings (omp.s) when the one that stays has none, the local
// progress of this device and the server marks (/viewed). Only then the release is removed; when the history can not be
// written, nothing is removed. Chromium 53 safe.
import type { Torrent } from '../api/types';
import type { TorrServerClient } from '../api/torrserver';
import { parseTorrentData } from '../api/torrserver';
import { mapFiles, mapJournal } from '../monitor/replace';
import { JOURNAL_MAX, parseData, type JournalEntry, type SkipPrefs } from '../lib/journal';
import { episodeLabel, fileKind, parseEpisode, type TorrentFile } from '../lib/episodes';
import { NO_SEASON } from '../lib/seriesGroups';
import { rewriteData, type JournalClient } from './journal';
import { carryProgress, clearProgress, continueWatching, localFileIds, serverViewed } from './progress';

export type CarryClient = JournalClient & Pick<TorrServerClient, 'loadInfo'> & Partial<Pick<TorrServerClient, 'setViewed'>>;

export type FileMap = { [fromId: number]: number | null };

function filesOf(t: Torrent): TorrentFile[] {
  return t.file_stats && t.file_stats.length ? t.file_stats : parseTorrentData(t.data);
}

function sameHash(a: string, b: string): boolean {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/** The files of a season (files without a season number stay); every file for NO_SEASON (a film too). */
export function seasonFiles(files: TorrentFile[], season: number): TorrentFile[] {
  if (season === NO_SEASON) return files;
  return files.filter((f) => {
    const n = parseEpisode(f.path).season;
    return n === null || n === season;
  });
}

/**
 * For each file of the release that goes, the file of the one that stays (null: none). The one that stays may be a
 * pack of several seasons: only its files of `season` are candidates, so «E03» never lands in another season.
 */
export function carryMap(fromFiles: TorrentFile[], toFiles: TorrentFile[], season: number): FileMap {
  const from = seasonFiles(fromFiles, season);
  const to = seasonFiles(toFiles, season);
  const map = mapFiles(from, to);
  // a film in two releases: one video each, named differently («Dune.2021.1080p.mkv», «Дюна.2160p.mkv»)
  const fromVideo = from.filter((f) => fileKind(f.path) === 'video');
  const toVideo = to.filter((f) => fileKind(f.path) === 'video');
  if (fromVideo.length === 1 && toVideo.length === 1 && map[fromVideo[0].id] == null && !episodeLabel(fromVideo[0].path) && !episodeLabel(toVideo[0].path)) {
    map[fromVideo[0].id] = toVideo[0].id;
  }
  return map;
}

/** The journal of the one that stays with the carried entries: one entry per slot (the newest), newest first. */
export function mergeJournals(own: JournalEntry[], carried: JournalEntry[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  own
    .concat(carried)
    .slice()
    .sort((a, b) => b.at - a.at)
    .forEach((e) => {
      const dup = out.filter((x) => x.f === e.f && x.src === e.src && (x.name || '') === (e.name || ''))[0];
      if (!dup) out.push(e);
    });
  return out.slice(0, JOURNAL_MAX);
}

/** The release that stays when `removed` goes: the one of `rows` watched last, else the newest; null when none is left. */
export function pickKeeper(rows: Torrent[], removed: Torrent): Torrent | null {
  const others = rows.filter((r) => !sameHash(r.hash, removed.hash));
  if (!others.length) return null;
  const recent = continueWatching(others, 1000)[0];
  if (recent) return recent.torrent;
  return others.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
}

export type CarryResult = { ok: true; moved: number } | { ok: false };

const INFO_TIMEOUT = 30000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** The file list, asked from the server when the list does not have it ([] when that fails). */
function filesNow(c: CarryClient, t: Torrent): Promise<TorrentFile[]> {
  const own = filesOf(t);
  if (own.length) return Promise.resolve(own);
  return withTimeout(c.loadInfo(t.hash), INFO_TIMEOUT).then(
    (i) => filesOf(i),
    () => [],
  );
}

/**
 * Moves what was watched in `removed` to `keeper` (both of the same season `season`, NO_SEASON for a film).
 * `{ ok: false }`: the history could not be written (the release must then stay). Nothing is removed here.
 */
export function carryWatch(c: CarryClient, removed: Torrent, keeper: Torrent, season: number): Promise<CarryResult> {
  return c.list().then(
    (all) => {
      const from = (all || []).filter((x) => !!x && sameHash(x.hash, removed.hash))[0] || removed;
      const to = (all || []).filter((x) => !!x && sameHash(x.hash, keeper.hash))[0];
      if (!to) return { ok: false } as CarryResult;
      const fromParsed = parseData(from.data);
      const journal = fromParsed ? fromParsed.journal : [];
      const skip: SkipPrefs | null = fromParsed ? fromParsed.skip : null;
      const local = localFileIds(from.hash);
      const viewed = serverViewed.value.filter((e) => sameHash(e.hash, from.hash));
      // nothing watched there: nothing to move
      if (!journal.length && !skip && !local.length && !viewed.length) return { ok: true, moved: 0 } as CarryResult;
      return Promise.all([filesNow(c, from), filesNow(c, to)]).then(([ff, tf]) => {
        // the history can not be matched without the file lists: never drop it silently
        if ((journal.length || local.length || viewed.length) && (!ff.length || !tf.length)) return { ok: false } as CarryResult;
        const map = carryMap(ff, tf, season);
        const carried = mapJournal(journal, map);
        const write = !carried.length && !skip
          ? Promise.resolve<'written' | 'same' | 'failed'>('same')
          : rewriteData(c, to.hash, (cur) => {
              const next = mergeJournals(cur.journal, carried);
              const nextSkip = cur.skip || skip;
              if (JSON.stringify(next) === JSON.stringify(cur.journal) && nextSkip === cur.skip) return null;
              return { journal: next, skip: nextSkip };
            });
        return write.then((w) => {
          if (w === 'failed') return { ok: false } as CarryResult;
          const moved = carryProgress(from.hash, to.hash, map);
          if (c.setViewed) {
            const set = c.setViewed.bind(c);
            viewed.forEach((e) => {
              const id = map[e.file_index];
              if (id === null || id === undefined) return;
              if (serverViewed.value.some((x) => sameHash(x.hash, to.hash) && x.file_index === id)) return;
              set(to.hash, id, e.timecode || 0).then(() => undefined, () => undefined);
            });
          }
          return { ok: true, moved: moved + carried.length } as CarryResult;
        });
      });
    },
    () => ({ ok: false }) as CarryResult,
  );
}

/** After the release is removed: its local progress goes too (it would only come back as a stale «Продолжить»). */
export function forgetRemoved(hash: string): void {
  clearProgress(hash);
}

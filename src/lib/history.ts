// «История»: the latest watch of every torrent from the journals on TorrServer (src/lib/journal.ts), plus the
// torrents without a journal from the older sources (local progress, TorrServer /viewed) shown as «Телевизор».
import type { Torrent } from '../api/types';
import { journalOf, type JournalSrc } from './journal';
import { seriesKey } from './seriesGroups';
import { parseEpisode } from './episodes';
import { displayTitle, torrentFiles } from './torrentName';
import { parseEpisodeRange } from '../monitor/episodes';
import { t } from '../i18n';
import { ru } from '../i18n/ru';
import { en } from '../i18n/en';

export type HistoryFilter = 'all' | 'tv' | 'phone';

export const historyFilters = (): { id: HistoryFilter; label: string }[] => [
  { id: 'all', label: t('common.all') },
  { id: 'tv', label: t('history.fromTv') },
  { id: 'phone', label: t('history.fromPhone') },
];

export function isHistoryFilter(v: unknown): v is HistoryFilter {
  return v === 'all' || v === 'tv' || v === 'phone';
}

export interface HistoryProgress {
  time: number;
  duration: number;
  updated: number;
  /** The player said this stop is not a finish, even near the end. */
  open?: boolean;
}

export interface HistorySource {
  src: JournalSrc;
  name?: string;
  /** Unix ms; 0 when unknown. */
  at: number;
}

export interface HistoryItem {
  torrent: Torrent;
  fileIndex: number;
  progress: HistoryProgress;
  source: HistorySource;
}

/** A «continue watching» entry of the older sources. */
export interface FallbackEntry {
  torrent: Torrent;
  fileIndex: number;
  progress: HistoryProgress;
}

/**
 * Newest first, one item per torrent (its latest watched file). `local` gives this device's own progress,
 * which wins over a journal entry of the same file when it is newer (the journal is written at start and exit only);
 * such an item is then labelled as `self`, this device.
 */
export function buildHistory(
  list: Torrent[],
  filter: HistoryFilter,
  fallback: FallbackEntry[],
  local: (hash: string, fileIndex: number) => HistoryProgress | null,
  limit = 40,
  self?: { src: JournalSrc; name?: string },
): HistoryItem[] {
  const withJournal: { [hash: string]: boolean } = {};
  const items: HistoryItem[] = [];
  list.forEach((t) => {
    const journal = journalOf(t.data);
    if (!journal.length) return;
    // journalOf is newest first: the first match with a real position is the latest watch for this filter.
    // A start entry at 0:00 with nothing after it is a start that never played (no network, wrong file):
    // it is not a watch, so it neither shows as «0:00» nor hides an older real position of the torrent.
    for (const e of journal) {
      if (filter !== 'all' && e.src !== filter) continue;
      const source: HistorySource = { src: e.src, at: e.at };
      if (e.name) source.name = e.name;
      let progress: HistoryProgress = { time: e.t, duration: e.d, updated: e.at };
      const own = local(t.hash, e.f);
      if (own && own.updated > e.at) {
        progress = { time: own.time, duration: own.duration > 0 ? own.duration : e.d, updated: own.updated };
        if (own.open) progress.open = true;
        source.at = own.updated;
        if (self) {
          source.src = self.src;
          if (self.name) source.name = self.name;
          else delete source.name;
        }
      }
      if (!(progress.time >= 1)) continue;
      withJournal[t.hash] = true;
      items.push({ torrent: t, fileIndex: e.f, progress, source });
      return;
    }
  });
  if (filter !== 'phone') {
    fallback.forEach((f) => {
      if (withJournal[f.torrent.hash]) return;
      items.push({
        torrent: f.torrent,
        fileIndex: f.fileIndex,
        progress: f.progress,
        source: { src: 'tv', at: f.progress.updated > 0 ? f.progress.updated : 0 },
      });
    });
  }
  // stable: equal times keep their order (fallback entries without a time stay at the end)
  const order = items.map((it, i) => ({ it, i }));
  order.sort((a, b) => b.it.source.at - a.it.source.at || a.i - b.i);
  // one row per episode: the same episode of the same show in two torrents (an old and a replacement
  // release) shows once, the newest
  const seen: { [k: string]: boolean } = {};
  const out: HistoryItem[] = [];
  for (const x of order) {
    const k = episodeKey(x.it);
    if (k) {
      if (seen[k]) continue;
      seen[k] = true;
    }
    out.push(x.it);
    if (out.length >= limit) break;
  }
  return out;
}

/** «show|season|episode» of a series item, '' when the show or the episode is not known. */
function episodeKey(it: HistoryItem): string {
  let show = '';
  try {
    show = seriesKey(it.torrent);
  } catch {
    show = '';
  }
  if (!show) return '';
  const file = torrentFiles(it.torrent).find((f) => f.id === it.fileIndex);
  if (!file) return '';
  const ep = parseEpisode(file.path);
  if (ep.episode === null) return '';
  // «Show.E01.mkv» names no season: take the torrent's («Show S02»); unknown either way, no dedupe
  const season = ep.season !== null ? ep.season : parseEpisodeRange(displayTitle(it.torrent)).season;
  if (season === null || season === undefined) return '';
  return show + '|' + season + '|' + ep.episode;
}

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** «сегодня 21:40», «вчера 22:15», «30 сентября» (with the year when it is not the current one). */
export function whenLabel(at: number, now: number): string {
  if (!(at > 0)) return '';
  const d = new Date(at);
  const time = pad(d.getHours()) + ':' + pad(d.getMinutes());
  const today = dayStart(now);
  const day = dayStart(at);
  if (day === today) return t('history.today', { time });
  // a calendar day back (not 24 h, DST-safe): the start of «yesterday» is the start of the day before today
  if (day === dayStart(today - 12 * 3600 * 1000)) return t('history.yesterday', { time });
  const label = t('date.day', { d: d.getDate(), month: t('date.monthsFull').split(' ')[d.getMonth()] });
  return d.getFullYear() === new Date(now).getFullYear() ? label : t('date.dayYear', { day: label, year: d.getFullYear() });
}

/** «Телевизор» / «Телефон «Pixel 7»» (a TV name, if one is ever written, is shown the same way). */
export function deviceLabel(src: JournalSrc, name?: string): string {
  const base = src === 'phone' ? t('history.phone') : t('history.tv');
  const isDefault = name === ru.history.phone || name === en.history.phone || name === base;
  return name && !isDefault ? t('history.named', { device: base, name }) : base;
}

/** «Телефон «Pixel 7» · сегодня 21:40»; without a known time just the device. */
export function sourceLine(s: HistorySource, now: number): string {
  const when = whenLabel(s.at, now);
  return deviceLabel(s.src, s.name) + (when ? ' · ' + when : '');
}

/** Where «Продолжить» starts: the saved position unless it is too early or (nearly) the end. `open` keeps a near-end stop the player said was not a finish. */
export function resumeFrom(p: HistoryProgress, minResume: number, watchedRatio: number): number {
  if (!(p.time >= minResume)) return 0;
  if (p.open) return p.time;
  if (p.duration > 0 && p.time / p.duration >= watchedRatio) return 0;
  return p.time;
}

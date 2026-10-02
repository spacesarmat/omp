// «История»: the latest watch of every torrent from the journals on TorrServer (src/lib/journal.ts), plus the
// torrents without a journal from the older sources (local progress, TorrServer /viewed) shown as «Телевизор».
import type { Torrent } from '../api/types';
import { journalOf, type JournalSrc } from './journal';

export type HistoryFilter = 'all' | 'tv' | 'phone';

export const HISTORY_FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'tv', label: 'С телевизора' },
  { id: 'phone', label: 'С телефона' },
];

export function isHistoryFilter(v: unknown): v is HistoryFilter {
  return v === 'all' || v === 'tv' || v === 'phone';
}

export interface HistoryProgress {
  time: number;
  duration: number;
  updated: number;
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
 * which wins over a journal entry of the same file when it is newer (the journal is written at start and exit only).
 */
export function buildHistory(
  list: Torrent[],
  filter: HistoryFilter,
  fallback: FallbackEntry[],
  local: (hash: string, fileIndex: number) => HistoryProgress | null,
  limit = 40,
): HistoryItem[] {
  const withJournal: { [hash: string]: boolean } = {};
  const items: HistoryItem[] = [];
  list.forEach((t) => {
    const journal = journalOf(t.data);
    if (!journal.length) return;
    withJournal[t.hash] = true;
    // journalOf is newest first: the first match is the latest watch for this filter
    const e = journal.filter((x) => filter === 'all' || x.src === filter)[0];
    if (!e) return;
    const source: HistorySource = { src: e.src, at: e.at };
    if (e.name) source.name = e.name;
    let progress: HistoryProgress = { time: e.t, duration: e.d, updated: e.at };
    const own = local(t.hash, e.f);
    if (own && own.updated > e.at) {
      progress = { time: own.time, duration: own.duration > 0 ? own.duration : e.d, updated: own.updated };
      source.at = own.updated;
    }
    items.push({ torrent: t, fileIndex: e.f, progress, source });
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
  return order.slice(0, limit).map((x) => x.it);
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

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
  if (day === today) return 'сегодня ' + time;
  // a calendar day back (not 24 h, DST-safe): the start of «yesterday» is the start of the day before today
  if (day === dayStart(today - 12 * 3600 * 1000)) return 'вчера ' + time;
  const label = d.getDate() + ' ' + MONTHS[d.getMonth()];
  return d.getFullYear() === new Date(now).getFullYear() ? label : label + ' ' + d.getFullYear();
}

/** «Телевизор» / «Телефон «Pixel 7»» (a TV name, if one is ever written, is shown the same way). */
export function deviceLabel(src: JournalSrc, name?: string): string {
  const base = src === 'phone' ? 'Телефон' : 'Телевизор';
  return name && name !== base ? base + ' «' + name + '»' : base;
}

/** «Телефон «Pixel 7» · сегодня 21:40»; without a known time just the device. */
export function sourceLine(s: HistorySource, now: number): string {
  const when = whenLabel(s.at, now);
  return deviceLabel(s.src, s.name) + (when ? ' · ' + when : '');
}

/** Where «Продолжить» starts: the saved position unless it is too early or (nearly) the end. */
export function resumeFrom(p: HistoryProgress, minResume: number, watchedRatio: number): number {
  if (!(p.time >= minResume)) return 0;
  if (p.duration > 0 && p.time / p.duration >= watchedRatio) return 0;
  return p.time;
}

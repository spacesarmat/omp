// TV side of the watch journal: one entry when an item starts (after the resume decision) and one when it is left
// (next item, exit, player closed) — not on every progress tick. Shared by the HTML5 (LG) and native (Android TV)
// players.
import type { JournalSrc } from '../lib/journal';
import type { PlayItem } from './types';

export interface JournalSource {
  src: JournalSrc;
  name?: string;
}

export type JournalRecorder = (hash: string, entry: { f: number; t: number; d: number; src: JournalSrc; name?: string }) => void;

/** Launched from a phone («Смотреть на ТВ»): the phone's entry is updated; otherwise the TV's own one. */
export function journalSource(from?: string): JournalSource {
  return from ? { src: 'phone', name: from } : { src: 'tv' };
}

export class WatchJournal {
  private current: PlayItem | null = null;
  private readonly record: JournalRecorder;
  private readonly source: JournalSource;

  constructor(record: JournalRecorder, source: JournalSource) {
    this.record = record;
    this.source = source;
  }

  private write(item: PlayItem, time: number, duration: number): void {
    if (!item.hash || item.fileIndex === undefined) return;
    const entry: { f: number; t: number; d: number; src: JournalSrc; name?: string } = {
      f: item.fileIndex,
      t: time > 0 ? Math.floor(time) : 0,
      d: duration > 0 ? Math.floor(duration) : 0,
      src: this.source.src,
    };
    if (this.source.name) entry.name = this.source.name;
    try {
      this.record(item.hash, entry);
    } catch (e) {
      // the journal never breaks playback
    }
  }

  /** The item started at `time` (once per start; a still open other item is dropped without a write). */
  start(item: PlayItem | undefined, time: number, duration: number): void {
    if (!item || item === this.current) return;
    this.current = item;
    this.write(item, time, duration);
  }

  /** The item is left at `time` (once: later calls for it are ignored until it starts again). */
  end(item: PlayItem | undefined, time: number, duration: number): void {
    if (!item || item !== this.current) return;
    this.current = null;
    if (!(time >= 1)) return; // nothing played: the start entry already says it
    this.write(item, time, duration);
  }
}

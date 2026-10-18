// What the phone's audiobook player asks the native service to play. Pure.
// A file is the whole stream. A chapter of one m4b is the same stream clipped to startMs..endMs
// (endMs 0 means the rest of the file). Speeds and the ±30s step match AudioSession.kt.
import { t } from '../i18n';

export const AUDIO_SEEK_MS = 30000;

/** 0.5× … 3×. The native side clamps anything outside this range. */
export const AUDIO_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export const SLEEP_CHOICES = ['off', '15', '30', '60', 'chapter'];

/** «Трек 2 из 12». index is 0-based. */
export function trackPlace(index: number, total: number): string {
  const n = index >= 0 ? index + 1 : 1;
  const all = total > 0 ? total : n;
  return t('audiobooks.trackOf', { n: n, total: all });
}

export interface AudioPlayItem {
  url: string;
  title: string;
  fileId: number;
  /** Absolute start in the file, ms. 0 for a whole file. */
  startMs: number;
  /** Absolute end in the file, ms. 0 plays through to the end of the file. */
  endMs: number;
}

export function filePlayItem(url: string, title: string, fileId: number): AudioPlayItem {
  return { url: url, title: title, fileId: fileId, startMs: 0, endMs: 0 };
}

/** [startSec, endSec] are ffprobe chapter bounds in seconds. An end at or before the start is left open. */
export function chapterPlayItem(url: string, title: string, fileId: number, startSec: number, endSec: number): AudioPlayItem {
  const startMs = Math.round(Math.max(0, startSec) * 1000);
  const endMs = endSec > startSec ? Math.round(endSec * 1000) : 0;
  return { url: url, title: title, fileId: fileId, startMs: startMs, endMs: endMs };
}

/** Position inside a clipped item. The native player seeks to this, not to the absolute file time. */
export function playOffsetMs(item: AudioPlayItem, positionMs: number): number {
  const asked = positionMs > 0 ? positionMs : 0;
  const start = item.startMs > 0 ? item.startMs : 0;
  return asked > start ? asked - start : 0;
}

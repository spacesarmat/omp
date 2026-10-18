// The queue a track tap hands to the native audiobook player, and the bridge the player screen calls.
// Tests replace the bridge; the page uses the OmpNative plugin.
import { signal } from '@preact/signals';
import type { AudioPlayItem } from '../../../src/lib/audiobookPlayback';
import { native, type AudioControlRequest, type AudioPlayState } from '../platform/native';

export interface AudioLaunch {
  hash: string;
  book: string;
  items: AudioPlayItem[];
  start: number;
  /** Absolute position in the file, ms. A chapter tap uses the chapter start. */
  positionMs: number;
  token: number;
}

let token = 1;

export const audioLaunch = signal<AudioLaunch | null>(null);

/** The item the native session is actually playing. A second tap on it only opens the player. */
export interface AudioNow {
  hash: string;
  token: number;
  index: number;
  fileId: number;
  startMs: number;
  active: boolean;
}

export const audioNow = signal<AudioNow | null>(null);

export function setAudioLaunch(q: Omit<AudioLaunch, 'token'>): AudioLaunch {
  const next = { ...q, token: token++ };
  audioLaunch.value = next;
  return next;
}

/** Remember the session's current item so the book card can highlight it and avoid restarting it. */
export function rememberAudio(s: AudioPlayState): void {
  const launch = audioLaunch.value;
  if (!s.active || !launch) return;
  if (s.hash && s.hash !== launch.hash) return;
  const item = launch.items[s.index];
  audioNow.value = {
    hash: launch.hash,
    token: launch.token,
    index: s.index,
    fileId: item ? item.fileId : s.fileId,
    startMs: item ? item.startMs : 0,
    active: true,
  };
}

/** The launch to reopen when this file (and chapter start) is already the current item. */
export function currentLaunch(hash: string, fileId: number, startMs: number): AudioLaunch | null {
  const now = audioNow.value;
  const launch = audioLaunch.value;
  if (!now || !now.active || !launch) return null;
  if (now.hash !== hash || launch.hash !== hash || now.token !== launch.token) return null;
  if (now.fileId !== fileId || now.startMs !== startMs) return null;
  return launch;
}

export interface AudioBridge {
  /** Asks for the notification permission before the player screen opens. */
  prepare(): Promise<void>;
  play(q: AudioLaunch): Promise<AudioPlayState | null>;
  control(c: AudioControlRequest): Promise<AudioPlayState | null>;
  state(): Promise<AudioPlayState | null>;
  onState(cb: (s: AudioPlayState) => void): () => void;
}

const real: AudioBridge = {
  prepare: () => native.audioPrepare(),
  play: (q) => native.audioPlay({ book: q.book, hash: q.hash, start: q.start, positionMs: q.positionMs, items: q.items }),
  control: (c) => native.audioControl(c),
  state: () => native.audioState(),
  onState: (cb) => native.onAudio(cb),
};

let bridge: AudioBridge = real;

export function audioBridge(): AudioBridge {
  return bridge;
}

/** Tests. Null restores the native plugin. */
export function setAudioBridge(b: AudioBridge | null): void {
  bridge = b || real;
}

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

export function setAudioLaunch(q: Omit<AudioLaunch, 'token'>): AudioLaunch {
  const next = { ...q, token: token++ };
  audioLaunch.value = next;
  return next;
}

export interface AudioBridge {
  play(q: AudioLaunch): Promise<AudioPlayState | null>;
  control(c: AudioControlRequest): Promise<AudioPlayState | null>;
  state(): Promise<AudioPlayState | null>;
  onState(cb: (s: AudioPlayState) => void): () => void;
}

const real: AudioBridge = {
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

import type { Cmd, PlayerState } from '../phone/protocol';
import type { PlayItem } from './types';
import { episodeLabel } from '../lib/episodes';

export interface SnapshotInput {
  queue: PlayItem[];
  index: number;
  time: number;
  duration: number;
  paused: boolean;
  buffering: boolean;
  audio: { label: string }[];
  audioIdx: number;
  defaultAudio: number;
  subs: { label: string; value: string }[];
  subChoice: string;
}

/** Null when the current item has no hash/fileIndex (the phone cannot address it). */
export function buildSnapshot(i: SnapshotInput): PlayerState | null {
  const item = i.queue[i.index];
  if (!item || !item.hash || item.fileIndex === undefined) return null;
  const nextItem = i.queue[i.index + 1];
  const s: PlayerState = {
    hash: item.hash,
    file: item.fileIndex,
    title: item.title,
    // the torrent title is not carried by PlayItem: the episode code is all we know
    subtitle: episodeLabel(item.title),
    time: i.time,
    duration: i.duration,
    paused: i.paused,
    buffering: i.buffering,
    audio: { list: i.audio.map((a) => a.label), sel: i.audioIdx >= 0 ? i.audioIdx : i.defaultAudio },
    subs: { list: i.subs.map((o) => ({ label: o.label, value: o.value })), sel: i.subChoice },
    next: nextItem ? { title: nextItem.title } : null,
  };
  if (item.poster) s.poster = item.poster;
  return s;
}

export interface CmdHandlers {
  paused: boolean;
  time: number;
  duration: number;
  subValues: string[];
  audioCount: number;
  toggle(): void;
  seekTo(t: number): void;
  next(): void;
  prev(): void;
  audio(i: number): void;
  subs(value: string): void;
}

function clamp(t: number, max: number): number {
  return Math.max(0, Math.min(max, t));
}

export function runCmd(cmd: Cmd, h: CmdHandlers): void {
  switch (cmd.type) {
    case 'play':
      if (h.paused) h.toggle();
      return;
    case 'pause':
      if (!h.paused) h.toggle();
      return;
    case 'seek':
      if (h.duration > 0) h.seekTo(clamp(cmd.t, h.duration));
      return;
    case 'skip':
      if (h.duration > 0) h.seekTo(clamp(h.time + cmd.d, h.duration));
      return;
    case 'next':
      h.next();
      return;
    case 'prev':
      h.prev();
      return;
    case 'audio':
      if (cmd.i < h.audioCount) h.audio(cmd.i);
      return;
    case 'subs':
      if (h.subValues.indexOf(cmd.value) >= 0) h.subs(cmd.value);
      return;
  }
}

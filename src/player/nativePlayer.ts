// Android TV: the native Media3 player (android/.../player/PlayerActivity.kt) driven from the TV app.
// The page keeps the latest state event for the phone bridge and saves progress like useProgressSync.
import type { TorrServerClient } from '../api/torrserver';
import type { OmpNativeTvPlugin, ListenerHandle } from '../platform/androidNative';
import type { Cmd, PlayerState } from '../phone/protocol';
import { episodeLabel } from '../lib/episodes';
import { guessLangFromName } from '../lib/tracks';
import { buildSnapshot } from './phoneBridge';
import { saveItemProgress, LOCAL_SAVE_MS, REMOTE_SAVE_MS } from './progressSave';
import { resumePosition } from '../store/progress';
import type { PlayItem } from './types';
import type { WatchJournal } from './watchJournal';

export interface NativeQueueItem {
  url: string;
  title: string;
  hash?: string;
  fileIndex?: number;
  /** Resume point (s) the native player seeks to when it advances to this item (0: from the start). */
  resume: number;
  subtitles: { url: string; label: string; ext: string; lang: string }[];
}

export interface NativeStartOptions {
  index: number;
  startAt: number;
  seekStep: number;
  autoNext: boolean;
  audioLang: string;
  subLang: string;
  subtitlesOn: boolean;
}

export interface NativeState {
  index: number;
  time: number;
  duration: number;
  paused: boolean;
  buffering: boolean;
  audio: { list: string[]; sel: number };
  subs: { list: { label: string; value: string }[]; sel: string };
}

export interface NativeClosed {
  index: number;
  time: number;
  duration: number;
}

/** «Раздача · S02E03 · Название» for the overlay (parts that repeat or are empty are left out). */
export function nativeHeading(item: PlayItem): string {
  const parts: string[] = [];
  [item.torrentTitle || '', episodeLabel(item.title), item.title].forEach((p) => {
    if (p && parts.indexOf(p) < 0) parts.push(p);
  });
  return parts.join(' · ');
}

/**
 * Queue for playNative: stream/subtitle URLs carry the TorrServer credentials (the native side turns them into a
 * Basic header); external subtitles get a language guessed from the file name for the preferred-language pick;
 * `resume` is the saved resume point of each item (LG asks «Продолжить просмотр?» per item, the native player
 * continues from it without a dialog).
 */
export function toNativeQueue(queue: PlayItem[], c: TorrServerClient | null): NativeQueueItem[] {
  const src = (u: string) => (c ? c.videoSrc(u) : u);
  return queue.map((it) => {
    const n: NativeQueueItem = {
      url: src(it.url),
      title: nativeHeading(it),
      resume: it.hash && it.fileIndex !== undefined ? resumePosition(it.hash, it.fileIndex) : 0,
      subtitles: (it.subtitles || []).map((s) => ({ url: src(s.url), label: s.label, ext: s.ext, lang: guessLangFromName(s.label) })),
    };
    if (it.hash) n.hash = it.hash;
    if (it.fileIndex !== undefined) n.fileIndex = it.fileIndex;
    return n;
  });
}

function isObj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}
function idx(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 ? v : null;
}

export function sanitizeNativeClosed(v: unknown): NativeClosed | null {
  if (!isObj(v)) return null;
  const i = idx(v.index);
  if (i === null) return null;
  return { index: i, time: Math.max(0, num(v.time)), duration: Math.max(0, num(v.duration)) };
}

export function sanitizeNativeState(v: unknown): NativeState | null {
  const base = sanitizeNativeClosed(v);
  if (!base || !isObj(v)) return null;
  const audio: { list: string[]; sel: number } = { list: [], sel: -1 };
  if (isObj(v.audio) && Array.isArray(v.audio.list)) {
    audio.list = v.audio.list.filter((x: unknown) => typeof x === 'string');
    audio.sel = typeof v.audio.sel === 'number' && v.audio.sel < audio.list.length ? Math.floor(v.audio.sel) : -1;
  }
  const subs: { list: { label: string; value: string }[]; sel: string } = { list: [{ label: 'Выкл', value: 'off' }], sel: 'off' };
  if (isObj(v.subs) && Array.isArray(v.subs.list)) {
    const list = v.subs.list.filter((o: unknown) => isObj(o) && typeof o.label === 'string' && typeof o.value === 'string')
      .map((o: { label: string; value: string }) => ({ label: o.label, value: o.value }));
    if (list.length) subs.list = list;
    if (typeof v.subs.sel === 'string') subs.sel = v.subs.sel;
  }
  return {
    index: base.index, time: base.time, duration: base.duration,
    paused: v.paused === true, buffering: v.buffering === true, audio, subs,
  };
}

/** Phone snapshot from the latest native state (same shape as the HTML5 player's buildSnapshot). */
export function nativeSnapshot(queue: PlayItem[], s: NativeState | null): PlayerState | null {
  if (!s) return null;
  return buildSnapshot({
    queue, index: s.index,
    time: s.time, duration: s.duration, paused: s.paused, buffering: s.buffering,
    audio: s.audio.list.map((label) => ({ label })), audioIdx: s.audio.sel, defaultAudio: 0,
    subs: s.subs.list, subChoice: s.subs.sel,
  });
}

export interface NativeSessionHooks {
  onState?(s: NativeState, prev: NativeState | null): void;
  /** `replaced`: another playNative took the open player over (this screen must not navigate). */
  onClosed?(s: NativeClosed, replaced: boolean): void;
}

let sessionSeq = 0;
let openRuns = 0;

/** True while a native player run is launching or open (its close has not arrived yet). */
export function nativePlayerOpen(): boolean {
  return openRuns > 0;
}

/** Events of another run (the player was re-launched with a new queue) carry a different `session`. */
function foreign(d: unknown, sid: number): boolean {
  return isObj(d) && d.session !== undefined && d.session !== sid;
}

/**
 * One run of the native player: listeners → playNative, progress saving (local 5 s, server 15 s, on item change
 * and on close), latest state for the phone, phone commands → nativePlayerCommand.
 * The cadence is driven by the state events (about one per second) rather than page timers: the WebView sits
 * behind PlayerActivity and its timers may be throttled, native events still arrive.
 */
export class NativeSession {
  state: NativeState | null = null;
  private readonly plugin: OmpNativeTvPlugin;
  private readonly client: TorrServerClient | null;
  private readonly queue: PlayItem[];
  private hooks: NativeSessionHooks;
  private launched = false;
  private handles: ListenerHandle[] = [];
  private lastLocal = 0;
  private lastRemote = 0;
  private pos: NativeClosed | null = null;
  private done = false;
  private readonly sid = ++sessionSeq;
  private readonly journal: WatchJournal | null;

  constructor(
    plugin: OmpNativeTvPlugin,
    client: TorrServerClient | null,
    queue: PlayItem[],
    hooks: NativeSessionHooks = {},
    journal: WatchJournal | null = null,
  ) {
    this.plugin = plugin;
    this.client = client;
    this.queue = queue;
    this.hooks = hooks;
    this.journal = journal;
  }

  start(o: NativeStartOptions): Promise<void> {
    const keep = (h: ListenerHandle) => {
      if (this.done) this.release(h);
      else this.handles.push(h);
    };
    // listeners first, so that no early event is missed
    return Promise.all([
      this.plugin.addListener('nativePlayerState', (d) => this.onState(d)).then(keep),
      this.plugin.addListener('nativePlayerClosed', (d) => this.onClosed(d)).then(keep),
    ])
      .then(() => {
        if (this.done) return undefined;
        this.lastLocal = this.lastRemote = Date.now();
        this.pos = { index: o.index, time: o.startAt, duration: 0 };
        this.launched = true;
        openRuns++;
        return this.plugin.playNative({
          queue: toNativeQueue(this.queue, this.client),
          index: o.index,
          startAt: o.startAt,
          session: this.sid,
          seekStep: o.seekStep,
          autoNext: o.autoNext,
          audioLang: o.audioLang,
          subLang: o.subLang,
          subtitlesOn: o.subtitlesOn,
        });
      })
      .then(() => {
        // the player is open: the first item starts (later ones in track)
        if (!this.done && this.journal && this.pos && this.pos.index === o.index) this.journal.start(this.queue[o.index], o.startAt, 0);
      }, (e) => {
        this.stop();
        throw e;
      });
  }

  snapshot(): PlayerState | null {
    return this.done ? null : nativeSnapshot(this.queue, this.state);
  }

  exec(cmd: Cmd): void {
    if (this.done) return;
    this.plugin.nativePlayerCommand({ cmd }).catch(() => undefined);
  }

  /**
   * The screen is gone (Back on the placeholder, route replaced): once playNative was called the run keeps
   * listening until the player reports its close (progress is still saved), without calling the hooks;
   * before that it simply stops.
   */
  detach(): void {
    if (this.done) return;
    this.hooks = {};
    if (!this.launched) this.stop();
  }

  /** Leaves without a close event: final save, listeners released. */
  dispose(): void {
    if (this.done) return;
    this.save(true);
    this.journalEnd();
    this.stop();
  }

  private onState(d: unknown): void {
    if (this.done || foreign(d, this.sid)) return;
    const s = sanitizeNativeState(d);
    if (!s || !this.queue[s.index]) return;
    this.track(s);
    const now = Date.now();
    if (now - this.lastRemote >= REMOTE_SAVE_MS) {
      this.lastRemote = this.lastLocal = now;
      this.save(true);
    } else if (now - this.lastLocal >= LOCAL_SAVE_MS) {
      this.lastLocal = now;
      this.save(false);
    }
    const prev = this.state;
    this.state = s;
    if (this.hooks.onState) this.hooks.onState(s, prev);
  }

  private onClosed(d: unknown): void {
    if (this.done || foreign(d, this.sid)) return;
    const c = sanitizeNativeClosed(d);
    if (c && this.queue[c.index]) this.track(c);
    this.save(true);
    this.journalEnd();
    this.stop();
    const replaced = isObj(d) && d.replaced === true;
    if (this.hooks.onClosed) this.hooks.onClosed(c || this.pos || { index: 0, time: 0, duration: 0 }, replaced);
  }

  /** New position; a change of item first saves the previous one (like useProgressSync on item change). */
  private track(p: NativeClosed): void {
    const changed = !!this.pos && this.pos.index !== p.index;
    if (changed) {
      this.save(true);
      this.journalEnd();
    }
    this.pos = { index: p.index, time: p.time, duration: p.duration };
    if (changed && this.journal) this.journal.start(this.queue[p.index], p.time, p.duration);
  }

  /** Watch journal: the current item is left at its last position. */
  private journalEnd(): void {
    const p = this.pos;
    if (this.journal && p) this.journal.end(this.queue[p.index], p.time, p.duration);
  }

  private save(remote: boolean): void {
    const p = this.pos;
    if (!p) return;
    saveItemProgress(this.client, this.queue[p.index], p.time, p.duration, remote);
  }

  private release(h: ListenerHandle): void {
    try { h.remove(); } catch (e) { /* ignore */ }
  }

  private stop(): void {
    if (this.launched) {
      this.launched = false;
      openRuns--;
    }
    this.done = true;
    this.handles.forEach((h) => this.release(h));
    this.handles = [];
  }
}

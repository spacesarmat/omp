// Android TV: the native player (Media3 or libVLC, android/.../player/PlayerActivity.kt) driven from the TV app.
// The page keeps the latest state event for the phone bridge and saves progress like useProgressSync.
import { t } from '../i18n';
import type { TorrServerClient } from '../api/torrserver';
import type { OmpNativeTvPlugin, ListenerHandle } from '../platform/androidNative';
import type { Cmd, PlayerState } from '../phone/protocol';
import { guessLangFromName } from '../lib/tracks';
import { buildSnapshot } from './phoneBridge';
import { saveItemProgress, LOCAL_SAVE_MS, REMOTE_SAVE_MS } from './progressSave';
import { resumePosition } from '../store/progress';
import type { PlayItem } from './types';
import { itemHeading } from './heading';
import type { WatchJournal } from './watchJournal';
import type { FfprobeResult } from '../api/types';
import type { SkipPrefs } from '../lib/journal';
import type { SkipPatch } from '../store/journal';
import { segmentsMessage, sanitizeNativeMark } from './nativeSkip';
import { applyMark, chapterList } from './chapters';
import { formatDuration } from '../lib/format';
import { errorMessage } from '../api/http';
import { DONATE_QR } from '../ui/donateQr';
import { DONATE_QR_LABEL } from '../lib/donate';
import { log } from '../lib/log';
import { getTrackPref, saveTrackPref } from '../store/trackPrefs';
import type { PlayerEngineSetting } from './nativeEngine';
import { assSubsShown, sanitizeNativeEngine, engineLogText, rememberProbe, knownProbe } from './nativeEngine';

export interface NativeQueueItem {
  url: string;
  title: string;
  hash?: string;
  fileIndex?: number;
  /** Resume point (s) the native player seeks to when it advances to this item (0: from the start). */
  resume: number;
  subtitles: { url: string; label: string; ext: string; lang: string }[];
  /** ffprobe (already known) says the subtitles to show are ASS/SSA: «Авто» opens the item with VLC. */
  assSubs?: boolean;
}

export interface NativeStartOptions {
  index: number;
  startAt: number;
  seekStep: number;
  autoNext: boolean;
  audioLang: string;
  subLang: string;
  subtitlesOn: boolean;
  /** Show the «Поддержать» card (pause, credits): not a supporter and a method opens the QR link. */
  donate?: boolean;
  /** «Плеер»: the setting, or the torrent's own choice (engineFor). */
  engine?: PlayerEngineSetting;
}

/** The «Поддержать» card of the native player: QR rows («1» dark, no quiet zone) and the short link. */
export interface NativeDonate {
  modules: number;
  bits: string;
  label: string;
}

/** The donate card for playNative; absent when it must not show. */
export function nativeDonate(on: boolean | undefined): NativeDonate | undefined {
  if (!on || DONATE_QR.bits.length !== DONATE_QR.modules * DONATE_QR.modules) return undefined;
  return { modules: DONATE_QR.modules, bits: DONATE_QR.bits, label: DONATE_QR_LABEL };
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

/** "Series name · S02E03" for the overlay, a film's name: the clean names, never the file name or the tracker title. */
export function nativeHeading(item: PlayItem): string {
  return itemHeading(item);
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
  const subs: { list: { label: string; value: string }[]; sel: string } = { list: [{ label: t('player.off'), value: 'off' }], sel: 'off' };
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
export function nativeSnapshot(queue: PlayItem[], s: NativeState | null, probe: FfprobeResult | null = null): PlayerState | null {
  if (!s) return null;
  return buildSnapshot({
    queue, index: s.index,
    time: s.time, duration: s.duration, paused: s.paused, buffering: s.buffering,
    audio: s.audio.list.map((label) => ({ label })), audioIdx: s.audio.sel, defaultAudio: 0,
    subs: s.subs.list, subChoice: s.subs.sel,
    chapters: chapterList(probe),
  });
}

/** ffprobe of a queue item (null: unavailable); drives chapters and skips in the native player. */
export type ProbeLoader = (item: PlayItem) => Promise<FfprobeResult | null>;

/** Skip settings of a torrent on the server (loadSkip / saveSkip of the watch journal). */
export interface SkipIo {
  load(hash: string): Promise<SkipPrefs>;
  save(hash: string, patch: SkipPatch): Promise<SkipPrefs>;
}

const NO_SKIP: SkipPrefs = { i: false, c: false };

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
  private readonly probeOf: ProbeLoader | null;
  private readonly skipIo: SkipIo | null;
  /** Items whose ffprobe was asked for, and its answer once it came (null: none). */
  private readonly asked: { [index: number]: boolean } = {};
  private readonly probes: { [index: number]: FfprobeResult | null } = {};
  /** Skip settings per torrent (absent while loading) and the intro start marked and waiting for its end. */
  private readonly prefs: { [hash: string]: SkipPrefs } = {};
  private readonly prefsAsked: { [hash: string]: boolean } = {};
  private readonly pending: { [hash: string]: number | null } = {};
  private readonly durations: { [index: number]: number } = {};
  /** The last segments message sent per item (sent again only when it changes). */
  private readonly sent: { [index: number]: string } = {};
  private donateOff = false;
  private opts: NativeStartOptions | null = null;

  constructor(
    plugin: OmpNativeTvPlugin,
    client: TorrServerClient | null,
    queue: PlayItem[],
    hooks: NativeSessionHooks = {},
    journal: WatchJournal | null = null,
    probeOf: ProbeLoader | null = null,
    skipIo: SkipIo | null = null,
  ) {
    this.plugin = plugin;
    this.client = client;
    this.queue = queue;
    this.hooks = hooks;
    this.journal = journal;
    this.probeOf = probeOf;
    this.skipIo = skipIo;
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
      this.plugin.addListener('nativePlayerMark', (d) => this.onMark(d)).then(keep),
      this.plugin.addListener('nativePlayerEngine', (d) => this.onEngine(d)).then(keep),
    ])
      .then(() => {
        if (this.done) return undefined;
        this.lastLocal = this.lastRemote = Date.now();
        this.pos = { index: o.index, time: o.startAt, duration: 0 };
        this.launched = true;
        openRuns++;
        this.opts = o;
        const donate = nativeDonate(o.donate);
        const queue = toNativeQueue(this.queue, this.client);
        queue.forEach((n, i) => { if (this.assKnown(i)) n.assSubs = true; });
        return this.plugin.playNative({
          ...(donate ? { donate } : {}),
          ...(o.engine ? { engine: o.engine } : {}),
          queue,
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
        if (!this.done) this.loadSkips(o.index);
      }, (e) => {
        this.stop();
        throw e;
      });
  }

  snapshot(): PlayerState | null {
    return this.done ? null : nativeSnapshot(this.queue, this.state, this.state ? this.probes[this.state.index] || null : null);
  }

  exec(cmd: Cmd): void {
    if (this.done) return;
    let out: Cmd = cmd;
    if (cmd.type === 'chapter') {
      // the native player only seeks: the page knows the chapters
      const list = chapterList(this.state ? this.probes[this.state.index] || null : null);
      const ch = list[cmd.i];
      if (!ch) return;
      out = { id: cmd.id, type: 'seek', t: ch.start };
    }
    this.plugin.nativePlayerCommand({ cmd: out }).catch(() => undefined);
  }

  /** A support code became known: the native player hides the «Поддержать» card for the rest of the run (once). */
  hideDonate(): void {
    if (this.done || this.donateOff) return;
    this.donateOff = true;
    this.plugin.nativePlayerCommand({ cmd: { type: 'donate', on: false, session: this.sid } }).catch(() => undefined);
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
    if (changed) this.loadSkips(p.index);
    // the credits mark is «the last N s»: its start needs the duration, known once the item plays
    const known = this.durations[p.index] || 0;
    if (p.duration > 0 && Math.abs(p.duration - known) >= 1) {
      this.durations[p.index] = p.duration;
      this.refresh(p.index);
    }
  }

  /**
   * Chapters and skips of an item go to the native player when the item becomes current: its ffprobe (once per
   * item) and the skip settings of its torrent (once per torrent); a failed probe counts as «no chapters».
   * Without a probe loader (no server) the item counts as probed without chapters (CH± switch episodes, as on LG).
   */
  private loadSkips(index: number): void {
    const item = this.queue[index];
    if (!item || this.asked[index]) return;
    this.asked[index] = true;
    const hash = item.hash;
    if (hash && !this.prefsAsked[hash]) {
      this.prefsAsked[hash] = true;
      const io = this.skipIo;
      (io ? io.load(hash) : Promise.resolve(NO_SKIP)).then((p) => p, () => NO_SKIP).then((p) => {
        if (this.prefs[hash]) return; // a mark saved meanwhile is newer
        this.prefs[hash] = p;
        this.refreshTorrent(hash);
      });
    }
    (this.probeOf ? this.probeOf(item) : Promise.resolve(null)).then((p) => p, () => null).then((probe) => {
      this.probes[index] = probe;
      if (item.hash && item.fileIndex !== undefined) rememberProbe(item.hash, item.fileIndex, probe);
      this.refresh(index);
      this.tellAss(index);
    });
  }

  /** Sends the segments message of an item when both answers are in and it differs from the last one sent. */
  private refresh(index: number): void {
    if (this.done || !(index in this.probes)) return;
    const hash = this.queue[index].hash;
    const prefs = hash ? this.prefs[hash] : NO_SKIP;
    if (!prefs) return;
    const pending = hash && this.pending[hash] !== undefined ? this.pending[hash] : null;
    const m = segmentsMessage(this.probes[index], prefs, this.durations[index] || 0, index, this.sid, pending);
    const key = JSON.stringify(m);
    if (this.sent[index] === key) return;
    this.sent[index] = key;
    this.plugin.nativePlayerCommand({ cmd: m }).catch(() => undefined);
  }

  /** The settings of a torrent changed: every item of it already sent gets the new message. */
  private refreshTorrent(hash: string): void {
    for (let i = 0; i < this.queue.length; i++) if (this.queue[i].hash === hash) this.refresh(i);
  }

  private toast(text: string, error = false): void {
    if (this.done) return;
    this.plugin.nativePlayerCommand({ cmd: { type: 'toast', text, error, session: this.sid } }).catch(() => undefined);
  }

  /**
   * «Отметить …» from the native player menu (time of the menu opening): the same rules as on LG (applyMark),
   * written with saveSkip; the player shows the result as a message and gets the new segments.
   */
  private onMark(d: unknown): void {
    if (this.done || foreign(d, this.sid)) return;
    const m = sanitizeNativeMark(d);
    const item = m && this.queue[m.index];
    if (!m || !item) return;
    const hash = item.hash;
    const prefs = (hash && this.prefs[hash]) || NO_SKIP;
    const pending = hash && this.pending[hash] !== undefined ? this.pending[hash] : null;
    const r = applyMark(m.kind, m.now, m.duration, prefs, pending, formatDuration);
    if (hash) {
      this.pending[hash] = r.pending;
      this.refreshTorrent(hash);
    }
    if (!r.patch) {
      this.toast(r.text, !!r.error);
      return;
    }
    const io = this.skipIo;
    if (!io || !hash) {
      this.toast(t('player.markNoServer'), true);
      return;
    }
    io.save(hash, r.patch).then(
      (saved) => {
        this.prefs[hash] = saved;
        this.refreshTorrent(hash);
        this.toast(r.text);
      },
      (e) => this.toast(t('player.markSaveFailed', { error: errorMessage(e) }), true),
    );
  }

  /** The item's ffprobe is known from earlier in this app run and its shown subtitles are ASS/SSA. */
  private assKnown(index: number): boolean {
    const item = this.queue[index];
    const o = this.opts;
    if (!o || !item || !item.hash || item.fileIndex === undefined) return false;
    const probe = knownProbe(item.hash, item.fileIndex);
    return !!probe && assSubsShown(probe, o, getTrackPref(item.hash));
  }

  /** «Авто»: the item's ffprobe answered with ASS/SSA subtitles to show → the player moves it to VLC. */
  private tellAss(index: number): void {
    const o = this.opts;
    const item = this.queue[index];
    if (this.done || !o || o.engine !== 'auto' || !item) return;
    if (!assSubsShown(this.probes[index] || null, o, item.hash ? getTrackPref(item.hash) : null)) return;
    this.plugin.nativePlayerCommand({ cmd: { type: 'assSubs', index, session: this.sid } }).catch(() => undefined);
  }

  /**
   * The player changed its engine: an automatic switch goes to the error log (generic text, no file name),
   * a choice from the player menu is remembered for the torrent (the next playNative sends it).
   */
  private onEngine(d: unknown): void {
    if (this.done || foreign(d, this.sid)) return;
    const e = sanitizeNativeEngine(d);
    const item = e && this.queue[e.index];
    if (!e || !item) return;
    const text = engineLogText(e);
    if (text) log('warn', 'tv', text);
    if (e.reason === 'manual' && item.hash) saveTrackPref(item.hash, { engine: e.engine });
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

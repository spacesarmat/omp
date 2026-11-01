// Keeps an external dub (a second media element, streamed from TorrServer) in step with the <video>.
// The video stays muted while the dub is the track the user hears. Pure decisions live in transportFix;
// ExternalDubLink only reads the two elements and applies the decision.
//
// Drift: under DUB_DRIFT_OK seconds, leave the rate alone. Up to DUB_DRIFT_SEEK, nudge playbackRate by at
// most DUB_NUDGE (audio ahead slows down, audio behind speeds up). Past that, seek the audio to the video.
// A stall of the video pauses the dub. A stall of the dub after it has started pauses the video, then lets
// it go when the dub can play. A seek, a pause, a rate change and the end of the episode follow the video.
//
// Chromium 53 (webOS): no lookbehind, no named groups, no Object.values.

/** Seconds. Closer than this is in sync. */
export const DUB_DRIFT_OK = 0.12;
/** Seconds. A wider gap is closed by seeking; a narrower one by a playbackRate nudge. */
export const DUB_DRIFT_SEEK = 0.45;
/** The largest relative playbackRate change used to chase a small gap (0.04 = 4%). */
export const DUB_NUDGE = 0.04;
/** How often a playing pair is corrected. */
export const DUB_CHECK_MS = 400;
/** The dub is given up when the video has been playing this long and the audio still has no metadata. */
export const DUB_OPEN_MS = 20000;
/** A video pause this soon after the dub's first play() is the TV refusing a second media pipeline. */
export const DUB_PIPELINE_MS = 800;
/** The dub file ended while the video still has at least this many seconds left: the file is unusable. */
export const DUB_EARLY_END_S = 8;

export interface TransportSample {
  videoPaused: boolean;
  videoEnded: boolean;
  videoSeeking: boolean;
  videoWaiting: boolean;
  videoTime: number;
  videoDuration: number;
  videoRate: number;
  audioPaused: boolean;
  audioEnded: boolean;
  /** loadedmetadata (or readyState >= HAVE_METADATA) has fired for this src. */
  audioHasMeta: boolean;
  /** The audio playing event has fired: later stalls pause the picture. */
  audioStarted: boolean;
  audioWaiting: boolean;
  audioTime: number;
  audioSeeking: boolean;
  /** The link paused the video because the dub stalled. */
  holdingVideo: boolean;
  /** The user paused. A hold does not count. */
  userPaused: boolean;
  /** A nudge is already applied (the return to the video rate uses a smaller gap). */
  nudging: boolean;
}

export interface TransportFix {
  /** What to do with the audio element. 'leave' means do not call play or pause. */
  audio: 'play' | 'pause' | 'leave';
  /** What to do with the video element. */
  video: 'play' | 'pause' | 'leave';
  /** Seek the audio here. Absent: do not seek. */
  seekAudioTo?: number;
  audioRate: number;
  nudging: boolean;
  /** The link should keep the video paused for the dub. */
  holding: boolean;
  /** Stop the dub and let the caller fall back to the built-in track. */
  giveUp: boolean;
}

function baseRate(r: number): number {
  return isFinite(r) && r >= 0.25 && r <= 4 ? r : 1;
}

function clampNudge(rate: number, base: number): number {
  const lo = base * (1 - DUB_NUDGE);
  const hi = base * (1 + DUB_NUDGE);
  if (rate < lo) return lo;
  if (rate > hi) return hi;
  return rate;
}

function leave(base: number, holding: boolean): TransportFix {
  return { audio: 'leave', video: 'leave', audioRate: base, nudging: false, holding: holding, giveUp: false };
}

/** A seek target when the dub is far from the picture. Absent when the gap is small or a seek is already going. */
function driftSeek(s: TransportSample): number | undefined {
  if (s.audioSeeking || !s.audioHasMeta) return undefined;
  if (!isFinite(s.videoTime) || !isFinite(s.audioTime)) return undefined;
  if (Math.abs(s.audioTime - s.videoTime) >= DUB_DRIFT_SEEK) return s.videoTime;
  return undefined;
}

/**
 * The next move for the pair. `giveUp` is the early end of the dub file; a codec error is the element's
 * own error event, which the link reports separately.
 */
export function transportFix(s: TransportSample): TransportFix {
  const base = baseRate(s.videoRate);
  const remain = s.videoDuration > 0 ? s.videoDuration - s.videoTime : 0;
  if (s.audioEnded && !s.videoEnded && remain > DUB_EARLY_END_S) {
    return { audio: 'pause', video: 'leave', audioRate: base, nudging: false, holding: false, giveUp: true };
  }
  // the file ended with the episode, or the user paused: do not start the dub again, but do follow a seek
  if (s.audioEnded || s.videoEnded || s.userPaused) {
    return { audio: s.audioPaused ? 'leave' : 'pause', video: 'leave', seekAudioTo: s.audioEnded ? undefined : driftSeek(s), audioRate: base, nudging: false, holding: false, giveUp: false };
  }
  // a pause the user did not ask for and we did not ask for either (seek and stall are flagged apart)
  if (s.videoPaused && !s.holdingVideo && !s.videoSeeking && !s.videoWaiting) {
    return { audio: s.audioPaused ? 'leave' : 'pause', video: 'leave', seekAudioTo: driftSeek(s), audioRate: base, nudging: false, holding: false, giveUp: false };
  }
  if (s.videoSeeking || s.videoWaiting) {
    return { audio: 'pause', video: 'leave', audioRate: base, nudging: false, holding: false, giveUp: false };
  }
  if (!s.audioHasMeta) return leave(base, false);
  // the first buffer: the picture keeps moving. A later stall holds it so the dub does not fall behind.
  // leave the dub element playing so it can fill its buffer; only the picture waits
  if (s.audioWaiting && s.audioStarted) {
    return { audio: 'leave', video: 'pause', audioRate: base, nudging: false, holding: true, giveUp: false };
  }
  if (s.audioSeeking) {
    return {
      audio: s.audioPaused ? 'play' : 'leave',
      video: s.holdingVideo ? 'play' : 'leave',
      audioRate: base,
      nudging: false,
      holding: false,
      giveUp: false,
    };
  }
  const drift = s.audioTime - s.videoTime;
  const abs = Math.abs(drift);
  let seekAudioTo: number | undefined;
  let rate = base;
  let nudging = false;
  if (!isFinite(s.audioTime) || !isFinite(s.videoTime) || abs >= DUB_DRIFT_SEEK) {
    seekAudioTo = isFinite(s.videoTime) ? s.videoTime : 0;
  } else {
    const back = s.nudging ? DUB_DRIFT_OK * 0.5 : DUB_DRIFT_OK;
    if (abs > back) {
      const span = DUB_DRIFT_SEEK - DUB_DRIFT_OK;
      const t = span > 0 ? Math.min(1, (abs - DUB_DRIFT_OK) / span) : 1;
      const sign = drift > 0 ? -1 : 1;
      rate = clampNudge(base * (1 + sign * DUB_NUDGE * Math.max(t, 0.35)), base);
      nudging = true;
    }
  }
  return {
    audio: s.audioPaused ? 'play' : 'leave',
    video: s.holdingVideo && s.videoPaused ? 'play' : 'leave',
    seekAudioTo: seekAudioTo,
    audioRate: rate,
    nudging: nudging,
    holding: false,
    giveUp: false,
  };
}

export interface DubElement {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  playbackRate: number;
  muted: boolean;
  readyState: number;
  error: { code: number } | null;
  /** 2 = NETWORK_LOADING. Absent on a fake. A loading dub is not given up on the open timer. */
  networkState?: number;
  play(): Promise<void> | void;
  pause(): void;
  load(): void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export interface DubVideo extends DubElement {
  audioTracks?: { length: number; [i: number]: { enabled?: boolean } | undefined };
}

export interface DubHooks {
  onFail(kind: 'decode' | 'pipeline'): void;
  onBuffering(on: boolean): void;
}

interface Listenable {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

/**
 * The video and the dub element. `playUrl` mutes the video and disables its built-in audio tracks (so the TV's
 * one audio decoder is free for the dub). `stop` unmutes, restores the built-in track and releases the element.
 * `dispose` is `stop` plus dropping the listeners: call it when the player leaves the screen.
 */
export class ExternalDubLink {
  private video: DubVideo | null = null;
  private audio: DubElement | null = null;
  private hooks: DubHooks = { onFail: () => undefined, onBuffering: () => undefined };
  private offs: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private url = '';
  private active = false;
  private generation = 0;
  private audioHasMeta = false;
  private audioStarted = false;
  private audioWaiting = false;
  private videoWaiting = false;
  private holding = false;
  private userPaused = false;
  private nudging = false;
  private silenced = false;
  private savedTrack = 0;
  private openedAt = 0;
  private armedAt = 0;
  private pipelineWatch = false;
  private sawAudioPlay = false;
  private stepping = false;
  private queued = false;
  private expectVideoPause = false;
  /** playUrl is silencing the built-in tracks: a pause from that is not the user and not a pipeline failure. */
  private ignorePause = false;

  bind(video: DubVideo, audio: DubElement, hooks: DubHooks): void {
    this.unbind();
    this.video = video;
    this.audio = audio;
    this.hooks = hooks;
    this.listen(video, {
      pause: () => this.onVideoPause(),
      play: () => this.onVideoPlay(),
      seeking: () => { this.step(); },
      seeked: () => { this.step(); },
      // waiting: playback has stopped for data. stalled is only a slow download and must not pause the dub.
      waiting: () => { this.videoWaiting = true; this.step(); },
      playing: () => { this.videoWaiting = false; this.step(); },
      canplay: () => { this.videoWaiting = false; this.step(); },
      ratechange: () => { this.nudging = false; this.step(); },
      ended: () => { this.step(); },
      emptied: () => this.onVideoEmptied(),
    });
    this.listen(audio, {
      loadedmetadata: () => { this.audioHasMeta = true; this.step(); },
      loadeddata: () => { this.audioHasMeta = true; this.step(); },
      canplay: () => { this.audioWaiting = false; this.audioHasMeta = true; this.step(); },
      playing: () => { this.audioStarted = true; this.audioWaiting = false; this.audioHasMeta = true; this.step(); },
      waiting: () => { if (this.audioStarted) this.audioWaiting = true; this.step(); },
      ended: () => { this.step(); },
      error: () => { if (this.active && this.url) this.fail('decode'); },
    });
    if (this.active && this.url) {
      this.silence(video);
      video.muted = true;
      this.attach();
      this.kick();
      this.ensureTimer();
    }
  }

  /** Stream `url` as the dub. The same url again does nothing. The video is muted. */
  playUrl(url: string): void {
    if (!url) return;
    if (this.active && this.url === url) return;
    // a pause we made for a stall is not the user's pause: the next file should keep the picture moving
    const held = this.holding && !this.userPaused;
    this.generation++;
    this.active = true;
    this.url = url;
    this.audioHasMeta = false;
    this.audioStarted = false;
    this.audioWaiting = false;
    this.holding = false;
    this.nudging = false;
    this.sawAudioPlay = false;
    this.pipelineWatch = false;
    this.openedAt = Date.now();
    this.userPaused = !!(this.video && this.video.paused) && !held;
    this.ignorePause = true;
    if (this.video) {
      this.video.muted = true;
      this.silence(this.video);
    }
    this.attach();
    // disabling the built-in tracks can pause the picture; put it back if the user had not paused
    if (this.video && this.video.paused && !this.userPaused) {
      const p = this.video.play();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    }
    this.kick();
    this.ignorePause = false;
    this.ensureTimer();
    this.reportBuffer();
  }

  /** Built-in audio again: unmute, restore the video's own track, release the dub element. */
  stop(): void {
    if (!this.active && !this.url && !this.silenced) {
      this.clearTimer();
      return;
    }
    const resume = this.holding && !this.userPaused;
    this.generation++;
    this.active = false;
    this.url = '';
    this.audioHasMeta = false;
    this.audioStarted = false;
    this.audioWaiting = false;
    this.holding = false;
    this.nudging = false;
    this.pipelineWatch = false;
    this.sawAudioPlay = false;
    this.clearTimer();
    const audio = this.audio;
    const video = this.video;
    if (audio) {
      try { audio.pause(); } catch (e) { /* already gone */ }
      try {
        audio.removeAttribute('src');
        audio.load();
      } catch (e2) { /* jsdom */ }
    }
    if (video) {
      this.restore(video);
      video.muted = false;
      if (resume && video.paused && !video.ended) {
        const p = video.play();
        if (p && typeof p.catch === 'function') p.catch(() => undefined);
      }
    }
    this.reportBuffer();
  }

  /** Pause or play, matching the on-screen button (a hold counts as paused). Returns false when no dub is active. */
  userToggle(): boolean {
    if (!this.active || !this.video) return false;
    if (this.video.paused) {
      this.userPaused = false;
      const p = this.video.play();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
      this.step();
    } else {
      this.userPaused = true;
      this.holding = false;
      this.reportBuffer();
      this.expectVideoPause = true;
      this.video.pause();
      if (this.audio && !this.audio.paused) this.audio.pause();
    }
    return true;
  }

  /** Drop listeners. Does not stop: `dispose` does both. */
  unbind(): void {
    for (let i = 0; i < this.offs.length; i++) this.offs[i]();
    this.offs = [];
    this.video = null;
    this.audio = null;
  }

  dispose(): void {
    this.stop();
    this.unbind();
  }

  /** One correction. The interval calls this; tests call it too. */
  step(): void {
    if (!this.active || !this.video || !this.audio) return;
    if (this.stepping) {
      this.queued = true;
      return;
    }
    this.stepping = true;
    try {
      if (this.audio.readyState >= 1) this.audioHasMeta = true;
      // still loading from TorrServer: keep waiting. A source the element will not open does not stay in NETWORK_LOADING.
      if (!this.audioHasMeta && this.audio.networkState !== 2 && this.video.currentTime > 2 && this.openedAt && Date.now() - this.openedAt > DUB_OPEN_MS) {
        this.fail('decode');
        return;
      }
      this.apply(transportFix(this.sample()));
    } finally {
      this.stepping = false;
      if (this.queued) {
        this.queued = false;
        this.step();
      }
    }
  }

  private sample(): TransportSample {
    const v = this.video;
    const a = this.audio;
    const dur = v && isFinite(v.duration) ? v.duration : 0;
    return {
      videoPaused: !v || v.paused,
      videoEnded: !!v && v.ended,
      videoSeeking: !!v && v.seeking,
      videoWaiting: this.videoWaiting,
      videoTime: v ? v.currentTime || 0 : 0,
      videoDuration: dur,
      videoRate: v ? v.playbackRate : 1,
      audioPaused: !a || a.paused,
      audioEnded: !!a && a.ended,
      audioHasMeta: this.audioHasMeta,
      audioStarted: this.audioStarted,
      audioWaiting: this.audioWaiting,
      audioTime: a ? a.currentTime || 0 : 0,
      audioSeeking: !!a && a.seeking,
      holdingVideo: this.holding,
      userPaused: this.userPaused,
      nudging: this.nudging,
    };
  }

  private apply(fix: TransportFix): void {
    if (!this.active || !this.video || !this.audio) return;
    if (fix.giveUp) {
      this.fail('decode');
      return;
    }
    this.holding = fix.holding;
    this.nudging = fix.nudging;
    const audio = this.audio;
    const video = this.video;
    if (fix.seekAudioTo !== undefined && !audio.seeking && Math.abs((audio.currentTime || 0) - fix.seekAudioTo) > 0.2) {
      try { audio.currentTime = fix.seekAudioTo; } catch (e) { /* not seekable yet */ }
    }
    if (Math.abs((audio.playbackRate || 1) - fix.audioRate) > 0.005) {
      try { audio.playbackRate = fix.audioRate; } catch (e2) { /* webOS may reject a rate */ }
    }
    if (fix.audio === 'pause' && !audio.paused) audio.pause();
    if (fix.audio === 'play' && audio.paused) this.playAudio();
    if (fix.video === 'pause' && !video.paused) {
      this.expectVideoPause = true;
      video.pause();
    }
    if (fix.video === 'play' && video.paused && !video.ended && !this.userPaused) {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    }
    this.reportBuffer();
  }

  private playAudio(): void {
    const audio = this.audio;
    if (!audio) return;
    if (!this.sawAudioPlay) {
      this.sawAudioPlay = true;
      this.pipelineWatch = true;
      this.armedAt = Date.now();
    }
    const gen = this.generation;
    try {
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err: { name?: string }) => this.onPlayRejected(err, gen));
      }
    } catch (e) {
      this.onPlayRejected(e as { name?: string }, gen);
    }
  }

  /** pause() and a seek abort the pending play(). That is not a codec failure. */
  private onPlayRejected(err: { name?: string } | null, gen: number): void {
    if (!this.active || this.generation !== gen) return;
    const name = err && typeof err.name === 'string' ? err.name : '';
    if (name === 'AbortError') return;
    this.fail('decode');
  }

  private kick(): void {
    if (!this.active || !this.audio || !this.audio.paused) return;
    if (this.userPaused || (this.video && this.video.paused)) return;
    this.playAudio();
  }

  private attach(): void {
    const audio = this.audio;
    if (!audio || !this.url) return;
    try { audio.pause(); } catch (e) { /* not playing */ }
    audio.setAttribute('src', this.url);
    try { audio.load(); } catch (e2) { /* jsdom */ }
  }

  private onVideoPause(): void {
    if (!this.active || this.ignorePause) return;
    if (this.expectVideoPause) {
      this.expectVideoPause = false;
      return;
    }
    if (this.pipelineWatch && Date.now() - this.armedAt < DUB_PIPELINE_MS) {
      this.fail('pipeline');
      return;
    }
    this.userPaused = true;
    this.holding = false;
    this.step();
  }

  private onVideoPlay(): void {
    if (!this.active || this.ignorePause) return;
    this.userPaused = false;
    this.videoWaiting = false;
    this.kick();
    this.step();
  }

  private onVideoEmptied(): void {
    if (!this.active || !this.pipelineWatch) return;
    if (Date.now() - this.armedAt < DUB_PIPELINE_MS) this.fail('pipeline');
  }

  private fail(kind: 'decode' | 'pipeline'): void {
    if (!this.active) return;
    const hooks = this.hooks;
    this.stop();
    hooks.onFail(kind);
  }

  private reportBuffer(): void {
    const early = this.active && !this.audioHasMeta && !!this.video && !this.video.paused && !this.video.ended;
    this.hooks.onBuffering(this.active && (this.holding || early));
  }

  private silence(video: DubVideo): void {
    const at = video.audioTracks;
    if (!at || typeof at.length !== 'number' || !at.length) return;
    let cur = 0;
    for (let i = 0; i < at.length; i++) if (at[i] && at[i]!.enabled) cur = i;
    this.savedTrack = cur;
    for (let i = 0; i < at.length; i++) {
      try { if (at[i]) at[i]!.enabled = false; } catch (e) { /* the last track may be stuck on */ }
    }
    this.silenced = true;
  }

  private restore(video: DubVideo): void {
    if (!this.silenced) return;
    this.silenced = false;
    const at = video.audioTracks;
    if (!at || typeof at.length !== 'number') return;
    const keep = this.savedTrack;
    for (let n = 0; n < at.length; n++) {
      try { if (at[n]) at[n]!.enabled = n === keep; } catch (e) { /* ignore */ }
    }
  }

  private listen(el: Listenable, map: { [type: string]: () => void }): void {
    for (const type in map) {
      if (!Object.prototype.hasOwnProperty.call(map, type)) continue;
      const fn = map[type];
      el.addEventListener(type, fn);
      this.offs.push(() => el.removeEventListener(type, fn));
    }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), DUB_CHECK_MS);
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

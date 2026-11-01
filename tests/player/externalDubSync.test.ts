import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DUB_DRIFT_OK, DUB_DRIFT_SEEK, DUB_NUDGE, DUB_OPEN_MS, DUB_EARLY_END_S,
  transportFix, ExternalDubLink, type TransportSample, type DubElement, type DubVideo, type DubHooks,
} from '../../src/player/externalDubSync';

function sample(over: Partial<TransportSample> = {}): TransportSample {
  return {
    videoPaused: false,
    videoEnded: false,
    videoSeeking: false,
    videoWaiting: false,
    videoTime: 10,
    videoDuration: 100,
    videoRate: 1,
    audioPaused: false,
    audioEnded: false,
    audioHasMeta: true,
    audioStarted: true,
    audioWaiting: false,
    audioTime: 10,
    audioSeeking: false,
    holdingVideo: false,
    userPaused: false,
    nudging: false,
    ...over,
  };
}

describe('transportFix', () => {
  it('leaves a small gap alone and keeps the video rate', () => {
    const fix = transportFix(sample({ audioTime: 10 + DUB_DRIFT_OK * 0.5, videoRate: 1.25 }));
    expect(fix.seekAudioTo).toBeUndefined();
    expect(fix.audioRate).toBe(1.25);
    expect(fix.nudging).toBe(false);
    expect(fix.audio).toBe('leave');
    expect(fix.giveUp).toBe(false);
  });

  it('slows the dub when it is a little ahead and speeds it when it is behind', () => {
    const ahead = transportFix(sample({ audioTime: 10.3 }));
    expect(ahead.seekAudioTo).toBeUndefined();
    expect(ahead.nudging).toBe(true);
    expect(ahead.audioRate).toBeLessThan(1);
    expect(ahead.audioRate).toBeGreaterThanOrEqual(1 - DUB_NUDGE - 1e-9);

    const behind = transportFix(sample({ audioTime: 9.7 }));
    expect(behind.audioRate).toBeGreaterThan(1);
    expect(behind.audioRate).toBeLessThanOrEqual(1 + DUB_NUDGE + 1e-9);
  });

  it('seeks when the gap is past the nudge range', () => {
    const fix = transportFix(sample({ audioTime: 10 + DUB_DRIFT_SEEK + 1, videoRate: 1.5 }));
    expect(fix.seekAudioTo).toBe(10);
    expect(fix.audioRate).toBe(1.5);
    expect(fix.nudging).toBe(false);
  });

  it('returns to the video rate once a nudge has closed the gap', () => {
    const fix = transportFix(sample({ audioTime: 10.04, nudging: true }));
    expect(fix.audioRate).toBe(1);
    expect(fix.nudging).toBe(false);
  });

  it('pauses the dub when the user pauses or the video stalls, and does not hold the picture', () => {
    expect(transportFix(sample({ userPaused: true, videoPaused: true })).audio).toBe('pause');
    expect(transportFix(sample({ userPaused: true, videoPaused: true })).holding).toBe(false);
    const stall = transportFix(sample({ videoWaiting: true }));
    expect(stall.audio).toBe('pause');
    expect(stall.holding).toBe(false);
    expect(stall.video).toBe('leave');
    const seeking = transportFix(sample({ videoSeeking: true, videoPaused: true }));
    expect(seeking.audio).toBe('pause');
    expect(seeking.holding).toBe(false);
  });

  it('holds the picture when the dub stalls after it has started, and lets the picture run before that', () => {
    const hold = transportFix(sample({ audioWaiting: true }));
    expect(hold.holding).toBe(true);
    expect(hold.video).toBe('pause');
    expect(hold.audio).toBe('leave');
    const early = transportFix(sample({ audioWaiting: true, audioStarted: false, audioPaused: true }));
    expect(early.holding).toBe(false);
    expect(early.video).toBe('leave');
    expect(early.audio).toBe('play');
  });

  it('resumes the picture when the dub has caught up', () => {
    const fix = transportFix(sample({ holdingVideo: true, videoPaused: true, audioPaused: true }));
    expect(fix.holding).toBe(false);
    expect(fix.video).toBe('play');
    expect(fix.audio).toBe('play');
  });

  it('does not start the dub before it has metadata, and stops it at the end of the episode', () => {
    const wait = transportFix(sample({ audioHasMeta: false, audioStarted: false, audioPaused: true }));
    expect(wait.audio).toBe('leave');
    expect(wait.video).toBe('leave');
    expect(transportFix(sample({ videoEnded: true, videoPaused: true })).audio).toBe('pause');
  });

  it('gives the dub up when its file ends while the episode still has a long way to go', () => {
    const early = transportFix(sample({ audioEnded: true, audioPaused: true, videoTime: 10 }));
    expect(early.giveUp).toBe(true);
    const tail = transportFix(sample({ audioEnded: true, audioPaused: true, videoTime: 100 - DUB_EARLY_END_S + 1 }));
    expect(tail.giveUp).toBe(false);
    expect(tail.audio).toBe('leave');
  });
});

class FakeMedia implements DubElement {
  currentTime = 0;
  duration = 100;
  paused = true;
  ended = false;
  seeking = false;
  playbackRate = 1;
  muted = false;
  readyState = 0;
  error: { code: number } | null = null;
  src = '';
  playResult: Promise<void> | void = undefined;
  private ls: { [k: string]: Array<() => void> } = {};
  addEventListener(type: string, fn: () => void): void {
    (this.ls[type] || (this.ls[type] = [])).push(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.ls[type] = (this.ls[type] || []).filter((f) => f !== fn);
  }
  dispatch(type: string): void {
    const list = (this.ls[type] || []).slice();
    for (let i = 0; i < list.length; i++) list[i]();
  }
  play(): Promise<void> | void {
    this.paused = false;
    this.dispatch('play');
    return this.playResult;
  }
  pause(): void {
    this.paused = true;
    this.dispatch('pause');
  }
  load(): void { /* noop */ }
  setAttribute(_name: string, value: string): void { this.src = value; }
  removeAttribute(): void { this.src = ''; }
}

class FakeVideo extends FakeMedia implements DubVideo {
  audioTracks = [{ enabled: true }, { enabled: false }];
}

function pair(): { video: FakeVideo; audio: FakeMedia; link: ExternalDubLink; fails: string[] } {
  const video = new FakeVideo();
  const audio = new FakeMedia();
  video.paused = false;
  const fails: string[] = [];
  const hooks: DubHooks = { onFail: (k) => { fails.push(k); }, onBuffering: () => undefined };
  const link = new ExternalDubLink();
  link.bind(video, audio, hooks);
  return { video, audio, link, fails };
}

describe('ExternalDubLink', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mutes the video, disables its audio tracks, and seeks the dub onto the picture', () => {
    const { video, audio, link } = pair();
    video.currentTime = 42;
    link.playUrl('http://srv/a.mka');
    expect(video.muted).toBe(true);
    expect(video.audioTracks[0].enabled).toBe(false);
    expect(audio.src).toBe('http://srv/a.mka');
    audio.readyState = 1;
    audio.currentTime = 0;
    audio.dispatch('loadedmetadata');
    expect(audio.currentTime).toBe(42);
    link.dispose();
    expect(video.muted).toBe(false);
    expect(video.audioTracks[0].enabled).toBe(true);
    expect(audio.src).toBe('');
  });

  it('pauses the dub with the video and seeks it when the video seeks', () => {
    const { video, audio, link } = pair();
    video.currentTime = 10;
    audio.currentTime = 10;
    audio.readyState = 2;
    link.playUrl('http://srv/a.mka');
    audio.dispatch('playing');
    link.userToggle();
    expect(video.paused).toBe(true);
    expect(audio.paused).toBe(true);
    video.currentTime = 30;
    video.seeking = true;
    video.dispatch('seeking');
    video.seeking = false;
    video.paused = false;
    video.dispatch('seeked');
    expect(audio.currentTime).toBe(30);
    link.dispose();
  });

  it('holds the video while the dub is stalled and lets it go when the dub plays', () => {
    const { video, audio, link } = pair();
    audio.readyState = 3;
    audio.currentTime = 10;
    video.currentTime = 10;
    link.playUrl('http://srv/a.mka');
    audio.dispatch('playing');
    expect(video.paused).toBe(false);
    audio.dispatch('waiting');
    expect(video.paused).toBe(true);
    audio.dispatch('playing');
    expect(video.paused).toBe(false);
    link.dispose();
  });

  it('falls back when the dub element errors or the picture dies as the dub starts', async () => {
    const bad = pair();
    bad.audio.playResult = Promise.reject(new Error('decode'));
    bad.link.playUrl('http://srv/a.mka');
    await Promise.resolve();
    await Promise.resolve();
    expect(bad.fails).toEqual(['decode']);
    expect(bad.video.muted).toBe(false);
    bad.link.dispose();

    const pipe = pair();
    pipe.link.playUrl('http://srv/b.mka');
    pipe.video.pause();
    expect(pipe.fails).toEqual(['pipeline']);
    expect(pipe.video.muted).toBe(false);
    pipe.link.dispose();
  });

  it('gives up when the dub never opens and the video is already playing', () => {
    const { video, link, fails } = pair();
    const t0 = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(t0);
    link.playUrl('http://srv/a.mka');
    video.currentTime = 5;
    (Date.now as unknown as { mockReturnValue: (n: number) => void }).mockReturnValue(t0 + DUB_OPEN_MS + 1);
    link.step();
    expect(fails).toEqual(['decode']);
    link.dispose();
  });
});

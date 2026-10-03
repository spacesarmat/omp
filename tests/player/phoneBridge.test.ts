import { describe, it, expect } from 'vitest';
import { buildSnapshot, liveTiming, runCmd } from '../../src/player/phoneBridge';
import type { PlayItem } from '../../src/player/types';

const H = 'c4c4bd6a4618e1042aa89649d629f85951eff546';
const item: PlayItem = { url: 'u', title: 'Show.S01E02.mkv', hash: H, fileIndex: 2, poster: 'p.jpg' };
const base = {
  queue: [item, { url: 'u2', title: 'Show.S01E03.mkv', hash: H, fileIndex: 3 }] as PlayItem[],
  index: 0,
  time: 10, duration: 100, paused: false, buffering: false,
  audio: [{ label: 'Rus' }, { label: 'Eng' }], audioIdx: 1, defaultAudio: 0,
  subs: [{ label: 'Выкл', value: 'off' }, { label: 'rus', value: 'e0' }], subChoice: 'e0',
};

describe('buildSnapshot', () => {
  it('builds state from item and video', () => {
    const s = buildSnapshot(base)!;
    expect(s.hash).toBe(H);
    expect(s.file).toBe(2);
    expect(s.title).toBe('Show.S01E02.mkv');
    expect(s.subtitle).toBe('S01E02');
    expect(s.poster).toBe('p.jpg');
    expect(s.audio).toEqual({ list: ['Rus', 'Eng'], sel: 1 });
    expect(s.subs.sel).toBe('e0');
    expect(s.next).toEqual({ title: 'Show.S01E03.mkv' });
  });
  it('builds subtitle from torrent title and episode code', () => {
    const q = (it2: PlayItem) => buildSnapshot({ ...base, queue: [it2] })!.subtitle;
    expect(q({ ...item, torrentTitle: 'Show' })).toBe('Show · S01E02');
    expect(q({ ...item, title: 'Movie', torrentTitle: 'Show' })).toBe('Show');
    expect(q({ ...item, title: 'Movie' })).toBe('');
  });
  it('maps audioIdx -1 to default and null next on last item', () => {
    const s = buildSnapshot({ ...base, audioIdx: -1, defaultAudio: 1, index: 1 })!;
    expect(s.audio.sel).toBe(1);
    expect(s.next).toBeNull();
    expect(s.poster).toBeUndefined();
  });
  it('returns null without hash or fileIndex', () => {
    expect(buildSnapshot({ ...base, queue: [{ url: 'u', title: 't' }] })).toBeNull();
    expect(buildSnapshot({ ...base, queue: [{ url: 'u', title: 't', hash: H }] })).toBeNull();
    expect(buildSnapshot({ ...base, index: 5 })).toBeNull();
  });
});

function harness(over: { paused?: boolean; time?: number; duration?: number } = {}) {
  const calls: string[] = [];
  const h = {
    paused: over.paused ?? false,
    time: over.time ?? 50,
    duration: over.duration ?? 100,
    subValues: ['off', 'e0'],
    audioCount: 2,
    toggle: () => calls.push('toggle'),
    seekTo: (t: number) => calls.push('seek:' + t),
    next: () => calls.push('next'),
    prev: () => calls.push('prev'),
    audio: (i: number) => calls.push('audio:' + i),
    subs: (v: string) => calls.push('subs:' + v),
  };
  return { h, calls };
}

describe('runCmd', () => {
  it('play/pause only toggle on state difference', () => {
    let x = harness({ paused: true });
    runCmd({ id: 1, type: 'play' }, x.h); expect(x.calls).toEqual(['toggle']);
    x = harness({ paused: true });
    runCmd({ id: 1, type: 'pause' }, x.h); expect(x.calls).toEqual([]);
    x = harness({ paused: false });
    runCmd({ id: 1, type: 'pause' }, x.h); expect(x.calls).toEqual(['toggle']);
    runCmd({ id: 1, type: 'play' }, x.h); expect(x.calls).toEqual(['toggle']);
  });
  it('clamps seek and skip', () => {
    const x = harness();
    runCmd({ id: 1, type: 'seek', t: 500 }, x.h);
    runCmd({ id: 2, type: 'seek', t: 30 }, x.h);
    runCmd({ id: 3, type: 'skip', d: -80 }, x.h);
    runCmd({ id: 4, type: 'skip', d: 80 }, x.h);
    expect(x.calls).toEqual(['seek:100', 'seek:30', 'seek:0', 'seek:100']);
  });
  it('seek with unknown duration is ignored', () => {
    const x = harness({ duration: 0 });
    runCmd({ id: 1, type: 'seek', t: 5 }, x.h);
    expect(x.calls).toEqual([]);
  });
  it('maps next/prev/audio/subs and validates indexes', () => {
    const x = harness();
    runCmd({ id: 1, type: 'next' }, x.h);
    runCmd({ id: 2, type: 'prev' }, x.h);
    runCmd({ id: 3, type: 'audio', i: 1 }, x.h);
    runCmd({ id: 4, type: 'audio', i: 5 }, x.h);
    runCmd({ id: 5, type: 'subs', value: 'e0' }, x.h);
    runCmd({ id: 6, type: 'subs', value: 'zzz' }, x.h);
    expect(x.calls).toEqual(['next', 'prev', 'audio:1', 'subs:e0']);
  });
});

describe('chapters', () => {
  const chapters = [
    { start: 0, end: 60, title: 'Пролог', kind: null },
    { start: 60, end: 200, title: 'Заставка', kind: 'intro' as const },
  ];
  it('snapshot carries starts, titles and the current index; none without chapters', () => {
    const s = buildSnapshot({ ...base, time: 100, chapters })!;
    expect(s.chapters).toEqual([{ t: 0, title: 'Пролог' }, { t: 60, title: 'Заставка' }]);
    expect(s.chapter).toBe(1);
    expect(buildSnapshot({ ...base, time: 0, chapters })!.chapter).toBe(0);
    const none = buildSnapshot({ ...base, chapters: [] })!;
    expect(none).not.toHaveProperty('chapters');
    expect(none).not.toHaveProperty('chapter');
    expect(buildSnapshot(base)!).not.toHaveProperty('chapters');
  });
  it('chapter command seeks to the start, ignores bad index and unknown duration', () => {
    const x = harness();
    const h = { ...x.h, chapterStarts: [0, 60, 200] };
    runCmd({ id: 1, type: 'chapter', i: 1 }, h);
    runCmd({ id: 2, type: 'chapter', i: 2 }, h);
    runCmd({ id: 3, type: 'chapter', i: 5 }, h);
    runCmd({ id: 4, type: 'chapter', i: 1 }, { ...h, duration: 0 });
    runCmd({ id: 5, type: 'chapter', i: 1 }, x.h);
    expect(x.calls).toEqual(['seek:60', 'seek:100']);
  });
});

describe('liveTiming', () => {
  it('reads the live video values when the video exists', () => {
    expect(liveTiming({ currentTime: 42.5, paused: true }, { time: 10, paused: false })).toEqual({ time: 42.5, paused: true });
  });
  it('falls back to the render-time values without a video or a finite time', () => {
    expect(liveTiming(null, { time: 10, paused: false })).toEqual({ time: 10, paused: false });
    expect(liveTiming({ currentTime: NaN, paused: false }, { time: 10, paused: true })).toEqual({ time: 10, paused: false });
  });
});

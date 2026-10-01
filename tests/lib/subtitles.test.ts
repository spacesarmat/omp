import { describe, it, expect } from 'vitest';
import { parseTime, parseSrt, parseAss, parseSubtitles, cueAt, decodeText } from '../../src/lib/subtitles';

const SRT = `1
00:00:01,000 --> 00:00:03,500
Привет, <i>мир</i>

2
00:00:04,000 --> 00:00:06,000
Строка 1
Строка 2
`;

const VTT = `WEBVTT

00:01.000 --> 00:02.000 align:start
Hello

00:00:03.000 --> 00:00:04.000
World
`;

const ASS = `[Script Info]
Title: test

[V4+ Styles]
Format: Name, Fontname

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:02.00,Default,,0,0,0,,{\\i1}Привет,\\Nмир
Dialogue: 0,0:00:00.50,0:00:01.00,Default,,0,0,0,,Первая
`;

describe('parseTime', () => {
  it('parses formats', () => {
    expect(parseTime('00:01:02,500')).toBe(62.5);
    expect(parseTime('01:02.250')).toBe(62.25);
    expect(parseTime('0:00:01.50')).toBe(1.5);
  });
});

describe('parseSrt', () => {
  it('parses cues and strips tags', () => {
    const c = parseSrt(SRT);
    expect(c).toEqual([
      { start: 1, end: 3.5, text: 'Привет, мир' },
      { start: 4, end: 6, text: 'Строка 1\nСтрока 2' },
    ]);
  });
  it('parses vtt', () => {
    const c = parseSrt(VTT);
    expect(c.map((x) => x.text)).toEqual(['Hello', 'World']);
    expect(c[0].start).toBe(1);
  });
});

describe('parseAss', () => {
  it('parses dialogue lines sorted by start', () => {
    const c = parseAss(ASS);
    expect(c).toEqual([
      { start: 0.5, end: 1, text: 'Первая' },
      { start: 1.5, end: 2, text: 'Привет,\nмир' },
    ]);
  });
});

describe('parseSubtitles/cueAt', () => {
  it('dispatches by ext and finds active cue', () => {
    const c = parseSubtitles(SRT, 'srt');
    expect(cueAt(c, 2)).toBe('Привет, мир');
    expect(cueAt(c, 3.7)).toBe('');
    expect(parseSubtitles(ASS, 'ass')).toHaveLength(2);
  });
});

describe('decodeText', () => {
  it('decodes utf-8', () => {
    const buf = new TextEncoder().encode('Привет').buffer;
    expect(decodeText(buf as ArrayBuffer)).toBe('Привет');
  });
  it('falls back to windows-1251', () => {
    // "Привет" in CP1251
    const bytes = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    expect(decodeText(bytes.buffer)).toBe('Привет');
  });
});

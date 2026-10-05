import { describe, it, expect } from 'vitest';
import { parseLaunchParams } from '../../src/lib/launchParams';

const HASH = '0123456789abcdef0123456789ABCDEF01234567';

describe('parseLaunchParams', () => {
  it('ignores empty and foreign params', () => {
    expect(parseLaunchParams(null)).toBeNull();
    expect(parseLaunchParams('')).toBeNull();
    expect(parseLaunchParams('not json')).toBeNull();
    expect(parseLaunchParams('{}')).toBeNull();
    expect(parseLaunchParams({ foo: 1 })).toBeNull();
    expect(parseLaunchParams([1, 2])).toBeNull();
  });
  it('parses each action from an object or a JSON string', () => {
    expect(parseLaunchParams({ server: ' 192.168.1.10:8090 ' })).toEqual({ server: '192.168.1.10:8090', invalid: false });
    expect(parseLaunchParams(JSON.stringify({ magnet: 'magnet:?xt=urn:btih:' + HASH }))).toEqual({
      action: { kind: 'magnet', link: 'magnet:?xt=urn:btih:' + HASH }, invalid: false,
    });
    expect(parseLaunchParams({ torrent: HASH })).toEqual({ action: { kind: 'torrent', hash: HASH.toLowerCase() }, invalid: false });
    expect(parseLaunchParams({ play: 'https://cdn.example/movie.mp4', title: ' Кино ' })).toEqual({
      action: { kind: 'play', url: 'https://cdn.example/movie.mp4', title: 'Кино' }, invalid: false,
    });
    expect(parseLaunchParams({ play: 'http://10.0.0.2:8090/stream/a%20b.mkv?link=x&play' })!.action).toEqual({
      kind: 'play', url: 'http://10.0.0.2:8090/stream/a%20b.mkv?link=x&play', title: 'a b.mkv',
    });
  });
  it('combines server with an action; magnet wins over torrent and play', () => {
    expect(parseLaunchParams({ server: 'h:1', torrent: HASH })).toEqual({ server: 'h:1', action: { kind: 'torrent', hash: HASH.toLowerCase() }, invalid: false });
    expect(parseLaunchParams({ magnet: 'magnet:?x', torrent: HASH, play: 'https://a/b' })!.action!.kind).toBe('magnet');
  });
  it('flags invalid values', () => {
    expect(parseLaunchParams({ server: '  ' })!.invalid).toBe(true);
    expect(parseLaunchParams({ magnet: 'http://x' })!.invalid).toBe(true);
    expect(parseLaunchParams({ torrent: 'xyz' })!.invalid).toBe(true);
    expect(parseLaunchParams({ play: 'file:///etc/passwd' })!.invalid).toBe(true);
    expect(parseLaunchParams({ play: 42 })!.invalid).toBe(true);
  });
  it('parses torrent with file and start time', () => {
    expect(parseLaunchParams({ torrent: HASH, file: 3, t: 1394 })!.action).toEqual({ kind: 'torrent', hash: HASH.toLowerCase(), file: 3, t: 1394 });
    expect(parseLaunchParams({ torrent: HASH, file: '2' })!.action).toEqual({ kind: 'torrent', hash: HASH.toLowerCase(), file: 2 });
    expect(parseLaunchParams({ torrent: HASH, file: -1 })!.invalid).toBe(true);
    expect(parseLaunchParams({ torrent: HASH, file: 1, t: 'x' })!.invalid).toBe(true);
    expect(parseLaunchParams({ torrent: HASH, t: 10 })!.invalid).toBe(true);
  });
});

describe('report param', () => {
  it('accepts an http url, trimmed', () => {
    expect(parseLaunchParams({ report: ' http://192.168.1.5:8765/r ' })).toEqual({ invalid: false, report: 'http://192.168.1.5:8765/r' });
  });
  it('combines with other params', () => {
    const p = parseLaunchParams({ report: 'http://h/r', torrent: HASH })!;
    expect(p.report).toBe('http://h/r');
    expect(p.action!.kind).toBe('torrent');
  });
  it('rejects https, long, non-string and empty', () => {
    expect(parseLaunchParams({ report: 'https://h/r' })!.invalid).toBe(true);
    expect(parseLaunchParams({ report: 'http://' + 'a'.repeat(200) })!.invalid).toBe(true);
    expect(parseLaunchParams({ report: 5 })!.invalid).toBe(true);
    expect(parseLaunchParams({ report: '' })!.invalid).toBe(true);
  });
  it('accepts exactly 200 chars', () => {
    const u = 'http://' + 'a'.repeat(193);
    expect(parseLaunchParams({ report: u })!.report).toBe(u);
  });
});

describe('launch params: from (watch journal source)', () => {
  const HASH40 = 'c4c4bd6a4618e1042aa89649d629f85951eff546';
  it('keeps the phone name with a file', () => {
    const p = parseLaunchParams({ torrent: HASH40, file: 2, t: 5, from: ' Pixel 7 ' })!;
    expect(p.invalid).toBe(false);
    expect(p.action).toEqual({ kind: 'torrent', hash: HASH40, file: 2, t: 5, from: 'Pixel 7' });
  });
  it('ignores it without a file or when it is not text, without making the plan invalid', () => {
    expect(parseLaunchParams({ torrent: HASH40, from: 'Pixel' })!.action).toEqual({ kind: 'torrent', hash: HASH40 });
    const p = parseLaunchParams({ torrent: HASH40, file: 1, from: 5 })!;
    expect(p.invalid).toBe(false);
    expect(p.action).toEqual({ kind: 'torrent', hash: HASH40, file: 1 });
  });
  it('cuts long names and control characters', () => {
    const p = parseLaunchParams({ torrent: HASH40, file: 1, from: 'a\nb' + 'x'.repeat(100) })!;
    const a = p.action as { from?: string };
    expect(a.from!.indexOf('\n')).toBe(-1);
    expect(a.from!.length).toBe(60);
  });
});


describe('lang param', () => {
  it('carries the phone language with any plan, alone too', () => {
    expect(parseLaunchParams({ lang: 'en' })).toEqual({ invalid: false, lang: 'en' });
    expect(parseLaunchParams({ lang: 'ru', torrent: HASH })!.lang).toBe('ru');
  });
  it('ignores an unknown language (a newer phone does not break an older TV)', () => {
    expect(parseLaunchParams({ lang: 'de' })).toBeNull();
    expect(parseLaunchParams({ lang: 5, torrent: HASH })!.lang).toBeUndefined();
    expect(parseLaunchParams({ lang: 5, torrent: HASH })!.invalid).toBe(false);
  });
});

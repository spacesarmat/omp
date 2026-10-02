import { describe, it, expect } from 'vitest';
import { parseM3U, isHlsPlaylist, parseStreamUrl } from '../../src/lib/m3u';

const TS = `#EXTM3U
#EXTINF:0,Star.Trek.S04E01.mkv
http://192.168.1.191:5665/stream/Star.Trek.S04E01.mkv?link=c4c4bd6a4618e1042aa89649d629f85951eff546&index=1&play
#EXTINF:0,Star.Trek.S04E02.mkv
http://192.168.1.191:5665/stream/Star.Trek.S04E02.mkv?link=c4c4bd6a4618e1042aa89649d629f85951eff546&index=2&play
`;

describe('parseM3U', () => {
  it('parses TorrServer playlist', () => {
    const r = parseM3U(TS);
    expect(r).toHaveLength(2);
    expect(r[0].title).toBe('Star.Trek.S04E01.mkv');
    expect(r[0].duration).toBe(0);
    expect(r[1].url).toContain('index=2');
  });
  it('parses attributes with commas in quotes', () => {
    const r = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-logo="http://x/l.png" group-title="Кино, HD",Первый канал\nhttp://x/1.m3u8\n');
    expect(r[0]).toEqual({ url: 'http://x/1.m3u8', title: 'Первый канал', duration: -1, logo: 'http://x/l.png', group: 'Кино, HD' });
  });
  it('resolves relative URLs and strips BOM', () => {
    const r = parseM3U('﻿#EXTM3U\r\n#EXTINF:10,A\r\nsub/a.mp4\r\n', 'http://host/list/p.m3u');
    expect(r[0].url).toBe('http://host/list/sub/a.mp4');
  });
  it('uses file name when EXTINF missing', () => {
    const r = parseM3U('http://h/x/My%20Video.mp4\n');
    expect(r[0].title).toBe('My Video.mp4');
    expect(r[0].duration).toBe(-1);
  });
  it('applies EXTGRP', () => {
    const r = parseM3U('#EXTM3U\n#EXTGRP:News\n#EXTINF:-1,A\nhttp://a\n');
    expect(r[0].group).toBe('News');
  });
  it('detects nested playlists by type attribute', () => {
    const r = parseM3U('#EXTM3U\n#EXTINF:0 tvg-logo="https://x.jpg" type="playlist",Star.Trek…\nhttp://192.168.1.191:5665/stream/Star.Trek….m3u?link=c4c4…&m3u&fn=file.m3u\n');
    expect(r[0].isPlaylist).toBe(true);
  });
  it('detects nested playlists by .m3u extension', () => {
    const r = parseM3U('#EXTM3U\n#EXTINF:-1,Nested\nhttp://h/a.m3u\n');
    expect(r[0].isPlaylist).toBe(true);
  });
  it('does not mark HLS .m3u8 as playlist', () => {
    const r = parseM3U('#EXTM3U\n#EXTINF:-1,HLS\nhttp://h/live.m3u8\n');
    expect(r[0].isPlaylist).toBeUndefined();
  });
  it('does not mark regular TorrServer entries as playlist', () => {
    const r = parseM3U(TS);
    expect(r[0].isPlaylist).toBeUndefined();
    expect(r[1].isPlaylist).toBeUndefined();
  });
  it('detects bare m3u parameter', () => {
    const r = parseM3U('#EXTM3U\n#EXTINF:-1,M3U List\nhttp://h/stream?m3u&link=abc\n');
    expect(r[0].isPlaylist).toBe(true);
  });
});

describe('isHlsPlaylist', () => {
  it('detects HLS media and master playlists', () => {
    expect(isHlsPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:10\n')).toBe(true);
    expect(isHlsPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8')).toBe(true);
    expect(isHlsPlaylist(TS)).toBe(false);
  });
});

describe('parseStreamUrl', () => {
  it('extracts hash and index', () => {
    expect(parseStreamUrl('http://h:5665/stream/x.mkv?link=c4c4bd6a4618e1042aa89649d629f85951eff546&index=2&play'))
      .toEqual({ hash: 'c4c4bd6a4618e1042aa89649d629f85951eff546', fileIndex: 2 });
    expect(parseStreamUrl('http://h:5665/play/c4c4bd6a4618e1042aa89649d629f85951eff546/3'))
      .toEqual({ hash: 'c4c4bd6a4618e1042aa89649d629f85951eff546', fileIndex: 3 });
  });
  it('returns null for other urls', () => {
    expect(parseStreamUrl('http://x/a.mp4')).toBeNull();
    expect(parseStreamUrl('http://h/stream?link=magnet:?xt=1&index=1')).toBeNull();
  });
});

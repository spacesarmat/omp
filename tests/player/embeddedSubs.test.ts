import { describe, it, expect } from 'vitest';
import { subtitleKind } from '../../src/lib/subCodec';
import { PgsDecoder, rle } from '../../src/lib/pgs';
import { LiveSubs, cuesFromPlaylist, textCues, type RangeSource } from '../../src/player/liveSubs';
import { probeReliable, probeTail } from '../../src/player/probeLoad';
import { mkvSeconds, parseCluster, type MkvPacket } from '../../src/lib/mkvSubs';
import { fittedPicture } from '../../src/player/pictureFit';

describe('subtitleKind', () => {
  it('keeps text, PGS and other image codecs apart', () => {
    expect(subtitleKind('subrip')).toBe('text');
    expect(subtitleKind('ASS')).toBe('text');
    expect(subtitleKind('hdmv_pgs_subtitle')).toBe('pgs');
    expect(subtitleKind('dvd_subtitle')).toBe('image');
    expect(subtitleKind('dvb_subtitle')).toBe('image');
    expect(subtitleKind('eia_608')).toBe('other');
  });
});

describe('PGS', () => {
  it('decodes a 2x1 run to white pixels', () => {
    const indices = rle(new Uint8Array([0x01, 0x01, 0x00, 0x00]), 2, 1);
    expect(Array.from(indices)).toEqual([1, 1]);
    const dec = new PgsDecoder();
    dec.feed(0, concat([
      seg(0x14, concat([new Uint8Array([0, 0]), new Uint8Array([1, 235, 128, 128, 255])])),
      seg(0x16, pcs(32, 16, 1, 4, 2)),
      seg(0x15, ods(1, 2, 1, new Uint8Array([0x01, 0x01, 0x00, 0x00]))),
      seg(0x80, new Uint8Array(0)),
    ]));
    const bmp = dec.bitmapAt(1);
    expect(bmp).toBeTruthy();
    expect(bmp && bmp.w).toBe(2);
    expect(bmp && bmp.h).toBe(1);
    expect(bmp && bmp.x).toBe(4);
    expect(bmp && bmp.y).toBe(2);
    expect(bmp && Array.from(bmp.rgba.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it('joins a continuation at byte 4 and rejects a huge declared size', () => {
    const dec = new PgsDecoder();
    const first = new Uint8Array(12);
    first[1] = 1;
    first[3] = 0x80;
    first[8] = 2;
    first[10] = 1;
    first[11] = 0x01;
    const next = new Uint8Array([0, 1, 0, 0x40, 0x01, 0x00, 0x00]);
    dec.feed(0, concat([
      seg(0x14, concat([new Uint8Array([0, 0]), new Uint8Array([1, 235, 128, 128, 255])])),
      seg(0x16, pcs(32, 16, 1, 0, 0)),
      seg(0x15, first),
      seg(0x15, next),
      seg(0x80, new Uint8Array(0)),
    ]));
    const bmp = dec.bitmapAt(0);
    expect(bmp && bmp.w).toBe(2);
    expect(bmp && Array.from(bmp.rgba.slice(0, 4))).toEqual([255, 255, 255, 255]);
    const huge = new PgsDecoder();
    huge.feed(0, concat([
      seg(0x16, pcs(8, 8, 1, 0, 0)),
      seg(0x15, ods(1, 65535, 65535, new Uint8Array([1]))),
      seg(0x80, new Uint8Array(0)),
    ]));
    expect(huge.bitmapAt(0)).toBeNull();
    const again = new PgsDecoder();
    const line = concat([
      seg(0x14, concat([new Uint8Array([0, 0]), new Uint8Array([1, 235, 128, 128, 255])])),
      seg(0x16, pcs(32, 16, 1, 0, 0)),
      seg(0x15, ods(1, 1, 1, new Uint8Array([0x01, 0x00, 0x00]))),
      seg(0x80, new Uint8Array(0)),
    ]);
    for (let n = 0; n < 4; n++) again.feed(n, line);
    const kept = again.bitmapAt(3);
    expect(kept && kept.w).toBe(1);
    const flood = new PgsDecoder();
    const mid = new Uint8Array([0, 1, 0, 0x00, 0x01]);
    const parts = [
      seg(0x16, pcs(8, 8, 1, 0, 0)),
      seg(0x15, first),
    ];
    for (let n = 0; n < 40; n++) parts.push(seg(0x15, mid));
    parts.push(seg(0x15, next));
    parts.push(seg(0x80, new Uint8Array(0)));
    flood.feed(0, concat(parts));
    expect(flood.bitmapAt(0)).toBeNull();
  });

  it('a composition with no objects clears the picture', () => {
    const dec = new PgsDecoder();
    dec.feed(0, concat([
      seg(0x15, ods(1, 1, 1, new Uint8Array([0x01, 0x00, 0x00]))),
      seg(0x16, pcs(8, 8, 1, 0, 0)),
      seg(0x80, new Uint8Array(0)),
    ]));
    dec.feed(2, concat([seg(0x16, pcs(8, 8, 0, 0, 0)), seg(0x80, new Uint8Array(0))]));
    expect(dec.bitmapAt(3)).toBeNull();
  });
});

describe('embedded text from a tiny MKV', () => {
  it('reads the SRT packet in the cluster the cue points at', async () => {
    const file = tinySrt('Hello');
    const live = new LiveSubs(mem(file), 0, 'text', null);
    await live.init();
    expect(live.failed).toBe(false);
    await live.poll(0);
    expect(live.cues.length).toBe(1);
    expect(live.cues[0].text).toBe('Hello');
    expect(live.cues[0].start).toBe(0);
  });

  it('uses a WebVTT playlist when the server can extract', async () => {
    const cues = await cuesFromPlaylist('#EXTM3U\n#EXTINF:4,\n0.vtt\n', async () => '1\n00:00:01.000 --> 00:00:02.000\nHi\n', 'http://s/');
    expect(cues && cues[0].text).toBe('Hi');
    expect(cues && cues[0].start).toBe(1);
  });

  it('reads Matroska ASS fields and the block time, not a Dialogue line', () => {
    const header = new TextEncoder().encode('[Events]\nFormat: ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n');
    const packets: MkvPacket[] = [{
      track: 1,
      start: 1.5,
      duration: 2,
      data: new TextEncoder().encode('0,0,Default,,0,0,0,,Hello, there'),
    }];
    const cues = textCues(packets, 'S_TEXT/ASS', header);
    expect(cues.length).toBe(1);
    expect(cues[0].text).toBe('Hello, there');
    expect(cues[0].start).toBe(1.5);
    expect(cues[0].end).toBe(3.5);
  });

  it('keeps subtitles from every cluster and converts timecodes to seconds', () => {
    expect(mkvSeconds(1000, 1000000)).toBe(1);
    const packets = parseCluster(concat([textCluster(0, 'A'), textCluster(1000, 'B')]), 1000000);
    expect(packets.map((p) => p.start)).toEqual([0, 1]);
    expect(utf8(packets[1].data)).toBe('B');
  });

  it('reads a complete text block when the cluster continues past the chunk', () => {
    const block = concat([new Uint8Array([0x81, 0x00, 0x00, 0x00]), new TextEncoder().encode('Hello')]);
    const payload = concat([el(0xe7, new Uint8Array([0])), el(0xa3, block)]);
    const partial = concat([idOf(0x1f43b675), sizeOf(payload.length + 10), payload]);
    const packets = parseCluster(partial, 1000000);
    expect(packets.length).toBe(1);
    expect(utf8(packets[0].data)).toBe('Hello');
  });
});

describe('fitted picture', () => {
  it('centers a narrower frame inside the player box', () => {
    expect(fittedPicture(1920, 1080, 1440, 1080)).toEqual({ left: 240, top: 0, width: 1440, height: 1080 });
  });
});

describe('probeReliable', () => {
  it('preloads the MKV tail and retries a failed probe once', async () => {
    let probes = 0;
    let tails = 0;
    const c = {
      preload: async () => undefined,
      preloadTail: async (_h: string, _i: number, _n: string, start: number, end: number) => {
        tails++;
        expect(end - start + 1).toBe(4 * 1024 * 1024);
      },
      probe: async () => {
        probes++;
        if (probes < 2) return null;
        return { streams: [{ index: 4, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle' }] };
      },
    };
    const size = 20 * 1024 * 1024;
    expect(probeTail(size)).toEqual({ start: size - 4 * 1024 * 1024, end: size - 1 });
    const r = await probeReliable(c, 'h', 1, 'film.mkv', size);
    expect(probes).toBe(2);
    expect(tails).toBe(2);
    expect(r && r.streams[0].codec_name).toBe('hdmv_pgs_subtitle');
  });

  it('retries when the first probe has streams but no subtitles, and keeps the richer list', async () => {
    let probes = 0;
    const c = {
      preload: async () => undefined,
      preloadTail: async () => undefined,
      probe: async () => {
        probes++;
        if (probes === 1) return { streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc' }, { index: 1, codec_type: 'audio', codec_name: 'aac' }] };
        return { streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc' }, { index: 2, codec_type: 'subtitle', codec_name: 'subrip' }] };
      },
    };
    const r = await probeReliable(c, 'h', 0, 'film.mkv', 20 * 1024 * 1024);
    expect(probes).toBe(2);
    expect(r && r.streams.map((s) => s.codec_type + ':' + s.index)).toEqual(['video:0', 'audio:1', 'subtitle:2']);
  });

  it('does not retry when the first probe already listed a subtitle stream', async () => {
    let probes = 0;
    const c = {
      preload: async () => undefined,
      preloadTail: async () => undefined,
      probe: async () => {
        probes++;
        return { streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc' }, { index: 1, codec_type: 'subtitle', codec_name: 'ass' }] };
      },
    };
    await probeReliable(c, 'h', 0, 'film.mkv', 20 * 1024 * 1024);
    expect(probes).toBe(1);
  });

  it('keeps chapters found on a retry that still has no subtitles', async () => {
    let probes = 0;
    const c = {
      preload: async () => undefined,
      preloadTail: async () => undefined,
      probe: async () => {
        probes++;
        if (probes === 1) return { streams: [{ index: 1, codec_type: 'audio', codec_name: 'aac' }] };
        return {
          streams: [{ index: 1, codec_type: 'audio', codec_name: 'aac' }],
          chapters: [{ start_time: '0', end_time: '90', tags: { title: 'Opening' } }],
        };
      },
    };
    const r = await probeReliable(c, 'h', 0, 'film.mkv', 20 * 1024 * 1024);
    expect(r && r.streams[0].codec_type).toBe('audio');
    expect(r && r.chapters && r.chapters[0].tags && r.chapters[0].tags.title).toBe('Opening');
  });

  it('keeps the first audio list when the retry comes back empty', async () => {
    let probes = 0;
    const c = {
      preload: async () => undefined,
      preloadTail: async () => undefined,
      probe: async () => {
        probes++;
        if (probes === 1) return { streams: [{ index: 0, codec_type: 'audio', codec_name: 'aac' }] };
        return null;
      },
    };
    const r = await probeReliable(c, 'h', 0, 'film.mkv', 20 * 1024 * 1024);
    expect(r && r.streams[0].codec_type).toBe('audio');
  });

  it('lists embedded text when the server has no ffprobe', async () => {
    const file = tinySrt('Hello');
    const c = {
      preload: async () => undefined,
      preloadTail: async () => undefined,
      probe: async () => null,
      fetchRange: async (_h: string, _i: number, _n: string, start: number, end: number) => file.subarray(start, end + 1),
    };
    const r = await probeReliable(c, 'h', 1, 'film.mkv', file.length);
    expect(r && r.streams.map((s) => ({ type: s.codec_type, codec: s.codec_name }))).toEqual([{ type: 'subtitle', codec: 'subrip' }]);
  });

  it('keeps the language of a PGS track found without ffprobe', async () => {
    const file = tinySrt('', 'S_HDMV/PGS', 'spa');
    const c = {
      preload: async () => undefined,
      preloadTail: async () => undefined,
      probe: async () => null,
      fetchRange: async (_h: string, _i: number, _n: string, start: number, end: number) => file.subarray(start, end + 1),
    };
    const r = await probeReliable(c, 'h', 1, 'film.mkv', file.length);
    expect(r && r.streams[0]).toMatchObject({ codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', tags: { language: 'spa' } });
  });
});

function seg(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(3 + payload.length);
  out[0] = type;
  out[1] = (payload.length >> 8) & 0xff;
  out[2] = payload.length & 0xff;
  out.set(payload, 3);
  return out;
}

function pcs(w: number, h: number, count: number, x: number, y: number): Uint8Array {
  const body = new Uint8Array(11 + (count ? 8 : 0));
  body[0] = (w >> 8) & 0xff;
  body[1] = w & 0xff;
  body[2] = (h >> 8) & 0xff;
  body[3] = h & 0xff;
  body[7] = 0x80;
  body[10] = count;
  if (count) {
    body[11] = 0;
    body[12] = 1;
    body[15] = (x >> 8) & 0xff;
    body[16] = x & 0xff;
    body[17] = (y >> 8) & 0xff;
    body[18] = y & 0xff;
  }
  return body;
}

function ods(id: number, w: number, h: number, rleBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(11 + rleBytes.length);
  out[0] = (id >> 8) & 0xff;
  out[1] = id & 0xff;
  out[3] = 0xc0;
  out[7] = (w >> 8) & 0xff;
  out[8] = w & 0xff;
  out[9] = (h >> 8) & 0xff;
  out[10] = h & 0xff;
  out.set(rleBytes, 11);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (let i = 0; i < parts.length; i++) n += parts[i].length;
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], o);
    o += parts[i].length;
  }
  return out;
}

function el(id: number, payload: Uint8Array): Uint8Array {
  const ib = idOf(id);
  const sb = sizeOf(payload.length);
  return concat([ib, sb, payload]);
}

function idOf(id: number): Uint8Array {
  const tmp: number[] = [];
  let n = id;
  while (n > 0) {
    tmp.push(n & 0xff);
    n = Math.floor(n / 256);
  }
  const out = new Uint8Array(tmp.length);
  for (let i = 0; i < tmp.length; i++) out[i] = tmp[tmp.length - 1 - i];
  return out;
}

function sizeOf(n: number): Uint8Array {
  return new Uint8Array([0x80 | n]);
}

function u24(n: number): Uint8Array {
  return new Uint8Array([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}

function utf8(u: Uint8Array): string {
  return new TextDecoder().decode(u);
}

function textCluster(tc: number, text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const tcBytes = tc < 256 ? new Uint8Array([tc]) : new Uint8Array([(tc >> 8) & 0xff, tc & 0xff]);
  const block = concat([new Uint8Array([0x81, 0x00, 0x00, 0x00]), bytes]);
  return el(0x1f43b675, concat([el(0xe7, tcBytes), el(0xa3, block)]));
}

function tinySrt(text: string, codecId = 'S_TEXT/UTF8', language = ''): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const block = concat([new Uint8Array([0x81, 0x00, 0x00, 0x00]), bytes]);
  const clusterPayload = concat([el(0xe7, new Uint8Array([0])), el(0xa3, block)]);
  const track = el(0xae, concat([
    el(0xd7, new Uint8Array([1])),
    el(0x83, new Uint8Array([0x11])),
    el(0x86, new TextEncoder().encode(codecId)),
    ...(language ? [el(0x22b59c, new TextEncoder().encode(language))] : []),
  ]));
  const info = el(0x1549a966, el(0x2ad7b1, u24(1000000)));
  const tracks = el(0x1654ae6b, track);
  const clusterOff = info.length + tracks.length;
  const cluster = el(0x1f43b675, clusterPayload);
  const cuePos = el(0xb7, el(0xf1, u24(clusterOff)));
  const cue = el(0xbb, concat([el(0xb3, new Uint8Array([0])), cuePos]));
  const cues = el(0x1c53bb6b, cue);
  const payload = concat([info, tracks, cluster, cues]);
  return el(0x18538067, payload);
}

function mem(file: Uint8Array): RangeSource {
  return {
    size: file.length,
    read: (start: number, end: number) => {
      if (start < 0 || end >= file.length || end < start) return Promise.resolve(null);
      return Promise.resolve(file.subarray(start, end + 1));
    },
  };
}

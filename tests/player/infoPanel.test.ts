import { describe, it, expect, afterEach } from 'vitest';
import { infoPanel, videoCodecName, hdrMark, shortTitle, bufferedAhead, rateParts, bitrateParts, videoSummary, BUFFER_TARGET_S } from '../../src/player/infoPanel';
import { applyLanguageSetting } from '../../src/i18n';
import type { CacheState, FfprobeResult } from '../../src/api/types';

const probe: FfprobeResult = {
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'hevc', codec_tag_string: 'dvh1', width: 3832, height: 1600, color_transfer: 'smpte2084', bit_rate: '15100000' },
    { index: 1, codec_type: 'audio', codec_name: 'eac3', channels: 6, disposition: { default: 1 } },
    { index: 2, codec_type: 'audio', codec_name: 'ac3', channels: 6 },
  ],
  format: { bit_rate: '16000000' },
};
const cache: CacheState = {
  Capacity: 1073741824, Filled: 52428800, PiecesLength: 1, PiecesCount: 1,
  Torrent: { hash: 'h', title: 't', stat: 3, connected_seeders: 9, active_peers: 11, total_peers: 40, download_speed: 3250586, preloaded_bytes: 547356672 },
};

afterEach(() => applyLanguageSetting('ru'));

describe('«Инфо» panel (LG)', () => {
  it('header, tiles, sound and buffer like the Android TV panel', () => {
    const p = infoPanel({ title: 'Тёмная материя · S04E02 · Пилот', probe, audioIndex: 1, cache, bufferedSec: 17.6 });
    expect(p.title).toBe('S04E02');
    expect(p.hdr).toBe('DV');
    expect(p.chip).toBe('HEVC · 3832×1600');
    expect(p.tiles).toEqual([
      { label: 'Сиды / пиры', value: '9 / 11', unit: '' },
      { label: 'Загрузка', value: '3,1', unit: 'МБ/с' },
      { label: 'Битрейт', value: '15,1', unit: 'Мбит/с' },
    ]);
    expect(p.sound).toBe('AC3 5.1');
    expect(p.buffer).toBe('522 МБ · 17 с');
    expect(p.bufferFill).toBeCloseTo(17.6 / BUFFER_TARGET_S);
  });

  it('Dolby Vision keeps its base codec, DV only as the mark; SDR has no mark', () => {
    expect(videoCodecName({ index: 0, codec_type: 'video', codec_name: 'hevc', codec_tag_string: 'dvhe' })).toBe('HEVC');
    expect(hdrMark({ index: 0, codec_type: 'video', codec_name: 'hevc', codec_tag_string: 'dvhe' })).toBe('DV');
    expect(hdrMark({ index: 0, codec_type: 'video', codec_name: 'hevc', color_transfer: 'arib-std-b67' })).toBe('HLG');
    expect(hdrMark({ index: 0, codec_type: 'video', codec_name: 'h264', color_transfer: 'bt709' })).toBe('');
    expect(videoCodecName({ index: 0, codec_type: 'video', codec_name: 'h264' })).toBe('AVC');
    expect(videoCodecName({ index: 0, codec_type: 'video', codec_name: 'av1' })).toBe('AV1');
    expect(videoSummary(probe)).toBe('HEVC · 3832×1600 · DV · 15,1 Мбит/с');
    expect(videoSummary(null)).toBe('');
  });

  it('a dash for what is unknown (no ffprobe, no or failed /cache, no buffer)', () => {
    const p = infoPanel({ title: 'Фильм (2024)', probe: null, audioIndex: -1, cache: null, bufferedSec: null });
    expect(p.title).toBe('Фильм (2024)');
    expect(p.hdr).toBe('');
    expect(p.chip).toBe('');
    expect(p.tiles.map((x) => x.value)).toEqual(['—', '—', '—']);
    expect(p.sound).toBe('—');
    expect(p.buffer).toBe('—');
    expect(p.bufferFill).toBe(0);
    // the default audio track when the playing one is unknown; the format bitrate without a stream one
    const q = infoPanel({ title: '', probe: { streams: [probe.streams[1]], format: { bit_rate: '8000000' } }, audioIndex: -1, cache: null, bufferedSec: 0 });
    expect(q.sound).toBe('E-AC3 5.1');
    expect(q.tiles[2]).toEqual({ label: 'Битрейт', value: '8,0', unit: 'Мбит/с' });
    expect(q.buffer).toBe('0 с');
  });

  it('the bar: player seconds against 30 s (full at most), else TorrServer preload against its cache', () => {
    expect(infoPanel({ title: '', probe: null, audioIndex: -1, cache: null, bufferedSec: 90 }).bufferFill).toBe(1);
    expect(infoPanel({ title: '', probe: null, audioIndex: -1, cache: { ...cache, Capacity: 2 * 547356672 }, bufferedSec: null }).bufferFill).toBeCloseTo(0.5);
  });

  it('units, short titles, the buffered range of the video', () => {
    expect(rateParts(0)).toEqual(['0', 'КБ/с']);
    expect(rateParts(358400)).toEqual(['350', 'КБ/с']);
    expect(bitrateParts(120e6)).toEqual(['120', 'Мбит/с']);
    expect(shortTitle('Show · s01e02')).toBe('S01E02');
    const ranges = (list: [number, number][]) => ({ length: list.length, start: (i: number) => list[i][0], end: (i: number) => list[i][1] }) as unknown as TimeRanges;
    expect(bufferedAhead({ buffered: ranges([[0, 10], [100, 130]]), currentTime: 110 })).toBe(20);
    expect(bufferedAhead({ buffered: ranges([[0, 10]]), currentTime: 50 })).toBe(0);
    expect(bufferedAhead({ buffered: ranges([]), currentTime: 0 })).toBeNull();
    expect(bufferedAhead(null)).toBeNull();
  });

  it('English, no Cyrillic', () => {
    applyLanguageSetting('en');
    const p = infoPanel({ title: 'Show · S04E02', probe, audioIndex: 0, cache, bufferedSec: 5 });
    expect(p.tiles.map((x) => x.label)).toEqual(['Seeds / peers', 'Download', 'Bitrate']);
    expect(p.tiles[1]).toEqual({ label: 'Download', value: '3.1', unit: 'MB/s' });
    expect(p.buffer).toBe('522 MB · 5 s');
    const all = [p.title, p.hdr, p.chip, p.sound, p.buffer].concat(p.tiles.map((x) => x.label + x.value + x.unit)).join(' ');
    expect(/[А-Яа-яЁё]/.test(all)).toBe(false);
  });
});

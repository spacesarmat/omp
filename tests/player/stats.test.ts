import { describe, it, expect } from 'vitest';
import { statsLines, hdrLabel } from '../../src/player/stats';

describe('hdrLabel', () => {
  it('detects HDR flavours', () => {
    expect(hdrLabel({ index: 0, codec_type: 'video', codec_name: 'hevc', color_transfer: 'smpte2084' })).toBe('HDR10');
    expect(hdrLabel({ index: 0, codec_type: 'video', codec_name: 'hevc', color_transfer: 'arib-std-b67' })).toBe('HLG');
    expect(hdrLabel({ index: 0, codec_type: 'video', codec_name: 'hevc', codec_tag_string: 'dvh1' })).toBe('Dolby Vision');
    expect(hdrLabel({ index: 0, codec_type: 'video', codec_name: 'h264', color_transfer: 'bt709' })).toBe('');
  });
});

describe('statsLines', () => {
  it('builds lines from cache and probe', () => {
    const lines = statsLines(
      {
        Capacity: 536870912, Filled: 134217728, PiecesLength: 2097152, PiecesCount: 10,
        Torrent: { hash: 'h', title: 't', stat: 3, download_speed: 1048576, active_peers: 3, total_peers: 7, connected_seeders: 2 },
      },
      {
        streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10', width: 3840, height: 2160, color_transfer: 'smpte2084' }],
        format: { bit_rate: '25000000' },
      },
    );
    expect(lines).toEqual([
      'Скорость: 1.0 MB/s',
      'Пиры: 3 / 7 (сиды 2)',
      'Кэш: 128 MB / 512 MB (25%)',
      'Видео: HEVC Main 10 3840×2160 HDR10',
      'Битрейт: 25.0 Мбит/с',
    ]);
  });
  it('clamps cache percent to 100', () => {
    const lines = statsLines({ Capacity: 100, Filled: 150, PiecesLength: 1, PiecesCount: 1 }, null);
    expect(lines).toEqual(['Кэш: 150 B / 100 B (100%)']);
  });
  it('handles missing data', () => {
    expect(statsLines(null, null)).toEqual([]);
  });
});

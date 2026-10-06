import { describe, it, expect, afterEach } from 'vitest';
import { statusText, statusLine } from '../../src/lib/torrentStatus';
import { fmtBytes, fmtSpeed, lang } from '../../src/i18n';

afterEach(() => {
  lang.value = 'ru';
});

describe('TorrServer states in the UI language', () => {
  it('maps every known stat string', () => {
    expect(statusText(0, 'Torrent added')).toBe('Добавлен');
    expect(statusText(1, 'Torrent getting info')).toBe('Загружается');
    expect(statusText(2, 'Torrent preload')).toBe('Предзагрузка');
    expect(statusText(3, 'Torrent working')).toBe('Работает');
    expect(statusText(4, 'Torrent closed')).toBe('Остановлен');
    expect(statusText(5, 'Torrent in db')).toBe('В базе');
  });

  it('falls back to the stat number, keeps an unknown string, nothing for none', () => {
    expect(statusText(3, '')).toBe('Работает');
    expect(statusText(3, 'TORRENT WORKING ')).toBe('Работает');
    expect(statusText(9, 'Torrent something new')).toBe('Torrent something new');
    expect(statusText(undefined, 'constructor')).toBe('constructor');
    expect(statusText(undefined, undefined)).toBe('');
  });

  it('builds the status line with localized units', () => {
    const working = { stat: 3, stat_string: 'Torrent working', torrent_size: 13314398618, download_speed: 0, active_peers: 0, total_peers: 285 };
    expect(statusLine(working)).toBe('12,4 ГБ · Работает · 0 Б/с · пиры 0/285');
    expect(statusLine({ ...working, download_speed: 1258291 })).toBe('12,4 ГБ · Работает · 1,2 МБ/с · пиры 0/285');
    expect(statusLine({ stat: 5, stat_string: 'Torrent in db' })).toBe('В базе');
    lang.value = 'en';
    expect(statusLine(working)).toBe('12.4 GB · Working · 0 B/s · peers 0/285');
  });

  it('formats sizes and speeds per language', () => {
    expect(fmtBytes(0)).toBe('0 Б');
    expect(fmtBytes(512)).toBe('512 Б');
    expect(fmtBytes(1536)).toBe('1,5 КБ');
    expect(fmtBytes(1000 * 1024 * 1024)).toBe('1000 МБ');
    expect(fmtSpeed(2048)).toBe('2,0 КБ/с');
    lang.value = 'en';
    expect(fmtBytes(1536)).toBe('1.5 KB');
    expect(fmtSpeed(0)).toBe('0 B/s');
  });
});

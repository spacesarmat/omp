import { describe, it, expect } from 'vitest';
import { parseHtml, textOf, absUrl, parseSize, parseDate, infohashFromMagnet } from '../../src/sources/html';

describe('parseHtml / textOf / absUrl', () => {
  it('parses a page and reads collapsed text', () => {
    const doc = parseHtml('<table><tr><td class="t"> Фильм&nbsp;(2026)\n  <b>1080p</b> </td></tr></table>');
    expect(textOf(doc.querySelector('.t'))).toBe('Фильм (2026) 1080p');
    expect(textOf(null)).toBe('');
  });
  it('resolves relative links', () => {
    expect(absUrl('/torrent/1/x', 'http://rutor.info/search/0/0/000/0/q')).toBe('http://rutor.info/torrent/1/x');
    expect(absUrl('viewtopic.php?t=5', 'https://nnmclub.to/forum/tracker.php')).toBe('https://nnmclub.to/forum/viewtopic.php?t=5');
    expect(absUrl('//cdn.site/a', 'https://site.org/b')).toBe('https://cdn.site/a');
    expect(absUrl('magnet:?xt=urn:btih:abc', 'https://site.org/')).toBe('magnet:?xt=urn:btih:abc');
    expect(absUrl('', 'https://site.org/b')).toBe('');
  });
});

describe('parseSize', () => {
  const G = 1024 * 1024 * 1024;
  it('reads Latin and Cyrillic units, dot or comma', () => {
    expect(parseSize('1.37 GB')).toBe(Math.round(1.37 * G));
    expect(parseSize('1,37 ГБ')).toBe(Math.round(1.37 * G));
    expect(parseSize('700 MB')).toBe(700 * 1024 * 1024);
    expect(parseSize('1.2 TiB')).toBe(Math.round(1.2 * 1024 * G));
    expect(parseSize('512 KB')).toBe(512 * 1024);
    expect(parseSize('2.5GB')).toBe(Math.round(2.5 * G));
    expect(parseSize('900 Б')).toBe(900);
    expect(parseSize('3 Мб')).toBe(3 * 1024 * 1024);
    expect(parseSize('1 234,5 MB')).toBe(Math.round(1234.5 * 1024 * 1024));
  });
  it('null when not a size', () => {
    expect(parseSize('')).toBeNull();
    expect(parseSize('большой')).toBeNull();
    expect(parseSize('12 parsecs')).toBeNull();
  });
});

describe('parseDate', () => {
  const now = new Date(2026, 9, 3, 12, 0, 0).getTime();
  it('reads tracker date formats as local time', () => {
    expect(parseDate('03 окт 26', now)).toBe(new Date(2026, 9, 3).getTime());
    expect(parseDate('3 Окт 2026', now)).toBe(new Date(2026, 9, 3).getTime());
    expect(parseDate('3-Окт-26', now)).toBe(new Date(2026, 9, 3).getTime());
    expect(parseDate('12 мая 2025 14:05', now)).toBe(new Date(2025, 4, 12, 14, 5).getTime());
    expect(parseDate('1 января 2024', now)).toBe(new Date(2024, 0, 1).getTime());
    expect(parseDate('03.10.2026', now)).toBe(new Date(2026, 9, 3).getTime());
    expect(parseDate('03.10.2026 21:40', now)).toBe(new Date(2026, 9, 3, 21, 40).getTime());
    expect(parseDate('2026-10-03', now)).toBe(new Date(2026, 9, 3).getTime());
    expect(parseDate('2026-10-03 21:40:10', now)).toBe(new Date(2026, 9, 3, 21, 40, 10).getTime());
  });
  it('ISO with a zone is absolute', () => {
    expect(parseDate('2026-10-03T21:40:00Z', now)).toBe(Date.UTC(2026, 9, 3, 21, 40));
    expect(parseDate('2026-10-03T21:40:00+03:00', now)).toBe(Date.UTC(2026, 9, 3, 18, 40));
  });
  it('today / yesterday', () => {
    expect(parseDate('сегодня в 21:40', now)).toBe(new Date(2026, 9, 3, 21, 40).getTime());
    expect(parseDate('Вчера в 08:05', now)).toBe(new Date(2026, 9, 2, 8, 5).getTime());
    expect(parseDate('Сегодня, 01:00', now)).toBe(new Date(2026, 9, 3, 1, 0).getTime());
  });
  it('undefined when unknown', () => {
    expect(parseDate('', now)).toBeUndefined();
    expect(parseDate('давно', now)).toBeUndefined();
    expect(parseDate('31 xyz 2026', now)).toBeUndefined();
  });
});

describe('infohashFromMagnet', () => {
  it('reads hex and base32 infohashes', () => {
    const hex = 'C12FE1C06BBA254A9DC9F519B335AA7C1367A88A';
    expect(infohashFromMagnet('magnet:?xt=urn:btih:' + hex + '&dn=x')).toBe(hex.toLowerCase());
    // base32 of the same 20 bytes
    expect(infohashFromMagnet('magnet:?dn=x&xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK')).toBe(hex.toLowerCase());
  });
  it('undefined otherwise', () => {
    expect(infohashFromMagnet('')).toBeUndefined();
    expect(infohashFromMagnet('magnet:?xt=urn:btih:123')).toBeUndefined();
    expect(infohashFromMagnet('http://x/a.torrent')).toBeUndefined();
  });
});

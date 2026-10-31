import { describe, expect, it } from 'vitest';
import { isShareUrl, parseTitleUrl, shareMessageText, titleUrl } from '../../src/lib/shareLink';

describe('title links', () => {
  it('builds a movie, a series and a season path with no query', () => {
    expect(titleUrl({ kind: 'movie', id: 550 })).toBe('https://omp-player.online/t/movie/550');
    expect(titleUrl({ kind: 'tv', id: 1396 })).toBe('https://omp-player.online/t/tv/1396');
    expect(titleUrl({ kind: 'tv', id: 1396, season: 2 })).toBe('https://omp-player.online/t/tv/1396/s/2');
    expect(titleUrl({ kind: 'tv', id: 1396, season: 0 })).toBe('https://omp-player.online/t/tv/1396/s/0');
    expect(titleUrl({ kind: 'movie', id: 550, season: 2 })).toBe('https://omp-player.online/t/movie/550');
    expect(titleUrl({ kind: 'movie', id: 0 })).toBe('');
    expect(titleUrl({ kind: 'tv', id: 5, season: 501 })).toBe('');
  });

  it('reads https, http, www and omp://t and ignores the query', () => {
    expect(parseTitleUrl('https://omp-player.online/t/movie/550')).toEqual({ kind: 'movie', id: 550 });
    expect(parseTitleUrl('https://omp-player.online/t/tv/1396/s/2/')).toEqual({ kind: 'tv', id: 1396, season: 2 });
    expect(parseTitleUrl('http://www.omp-player.online/t/tv/8/s/0?utm_source=x#a')).toEqual({ kind: 'tv', id: 8, season: 0 });
    expect(parseTitleUrl('omp://t/tv/12/s/3')).toEqual({ kind: 'tv', id: 12, season: 3 });
    expect(parseTitleUrl('https://omp-player.online/t/movie/550/s/1')).toBeNull();
    expect(parseTitleUrl('https://example.com/t/movie/550')).toBeNull();
    expect(parseTitleUrl('omp://billing?code=ABCD-EFGH')).toBeNull();
    expect(parseTitleUrl('magnet:?xt=urn:btih:' + 'a'.repeat(40))).toBeNull();
    expect(parseTitleUrl('')).toBeNull();
  });

  it('puts title, year and a short line above the link and drops a magnet or a hash', () => {
    const url = 'https://omp-player.online/t/tv/9/s/2';
    expect(shareMessageText('Институт', 2026, 'Сезон 2 выходит 8 нояб.', url)).toBe(
      'Институт\n2026\nСезон 2 выходит 8 нояб.\n' + url,
    );
    expect(shareMessageText('OMP - плеер для фильмов и сериалов', 0, '', 'https://omp-player.online')).toBe(
      'OMP - плеер для фильмов и сериалов\nhttps://omp-player.online',
    );
    expect(shareMessageText('magnet:?xt=urn:btih:' + 'ab'.repeat(20), 2026, 'a'.repeat(40), url)).toBe('2026\n' + url);
    expect(shareMessageText('Фильм', 2026, 'ок', 'https://omp-player.online/t/movie/1?x=1')).toBe('');
    expect(shareMessageText('Фильм', 2026, 'ок', 'https://evil.example/t/movie/1')).toBe('');
    expect(isShareUrl('https://omp-player.online/')).toBe(true);
    expect(isShareUrl(url + '#t')).toBe(false);
  });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  resultKey,
  qualityOf,
  filterQuality,
  sortResults,
  progressText,
  healthText,
  resolveLink,
  sourceName,
  resultDate,
  jackettHint,
  stableOrder,
  seedsText,
  sourceBadge,
  isCloudflare,
} from '../../src/sources/view';
import { registerSource, unregisterSource } from '../../src/sources/registry';
import { mergeResults } from '../../src/sources/merge';
import type { Source, SourceContext, SourceResult } from '../../src/sources/types';

const ctx: SourceContext = {
  http: { get: () => Promise.reject(new Error('no')), post: () => Promise.reject(new Error('no')), clearCookies: () => Promise.resolve() },
  client: null,
};

function res(p: Partial<SourceResult>): SourceResult {
  return { Title: 'T', Categories: '', Size: '', CreateDate: '', Tracker: '', Link: '', Magnet: '', Hash: '', Peer: 0, Seed: 0, source: 'x', ...p };
}

afterEach(() => {
  unregisterSource('fake-mag');
  unregisterSource('fake-torrent');
});

describe('resultKey', () => {
  it('prefers the release page, then Link, Hash, Title', () => {
    expect(resultKey(res({ detailUrl: 'https://a/1', Link: 'https://a/dl', Hash: 'h', Title: 'T' }))).toBe('https://a/1');
    expect(resultKey(res({ Link: 'https://a/dl', Hash: 'h' }))).toBe('https://a/dl');
    expect(resultKey(res({ Hash: 'h' }))).toBe('h');
    expect(resultKey(res({ Title: 'Same' }))).toBe('Same');
  });
  it('two torrents with one title but different pages get different keys', () => {
    const a = res({ Title: 'Аниме [HWP]', detailUrl: 'https://tr.anidub.com/x.html#torrent_1_info' });
    const b = res({ Title: 'Аниме [HWP]', detailUrl: 'https://tr.anidub.com/x.html#torrent_2_info' });
    expect(resultKey(a)).not.toBe(resultKey(b));
  });
});

describe('quality', () => {
  it('reads the resolution from the title', () => {
    expect(qualityOf('Film 2160p HDR')).toBe(2160);
    expect(qualityOf('Film 4K UHD')).toBe(2160);
    expect(qualityOf('Film (S01) WEB-DL 1080p')).toBe(1080);
    expect(qualityOf('Film 1080i')).toBe(1080);
    expect(qualityOf('Film 720p')).toBe(720);
    expect(qualityOf('Film DVDRip')).toBe(0);
    expect(qualityOf('Sk4ka')).toBe(0);
  });
  it('filters 1080p+ and 2160p', () => {
    const list = [res({ Title: 'a 720p' }), res({ Title: 'b 1080p' }), res({ Title: 'c 2160p' }), res({ Title: 'd' })];
    expect(filterQuality(list, '').map((r) => r.Title)).toEqual(['a 720p', 'b 1080p', 'c 2160p', 'd']);
    expect(filterQuality(list, '1080').map((r) => r.Title)).toEqual(['b 1080p', 'c 2160p']);
    expect(filterQuality(list, '2160').map((r) => r.Title)).toEqual(['c 2160p']);
  });
});

describe('sortResults', () => {
  const list = [
    res({ Title: 'a', Seed: 5, date: 300, sizeBytes: 10 }),
    res({ Title: 'b', Seed: 50, date: 100, sizeBytes: 30 }),
    res({ Title: 'c', Seed: 5, date: 200, Size: '2 GB' }),
    res({ Title: 'd', Seed: 0 }),
  ];
  it('by seeds (stable), by date, by size', () => {
    expect(sortResults(list, 'seeds').map((r) => r.Title)).toEqual(['b', 'a', 'c', 'd']);
    expect(sortResults(list, 'date').map((r) => r.Title)).toEqual(['a', 'c', 'b', 'd']);
    expect(sortResults(list, 'size').map((r) => r.Title)).toEqual(['c', 'b', 'a', 'd']);
  });
  it('keeps the input untouched', () => {
    const copy = list.slice();
    sortResults(list, 'date');
    expect(list).toEqual(copy);
  });
});

describe('progressText', () => {
  it('while searching names the pending sources', () => {
    expect(progressText({ found: 38, answered: 7, total: 9, pending: ['rutracker'], failed: [] })).toBe(
      'Найдено 38 · 7 из 9 источников ответили · ещё ищу в rutracker…',
    );
  });
  it('one source and the singular forms', () => {
    expect(progressText({ found: 1, answered: 1, total: 1, pending: [], failed: [] })).toBe('Найдено 1 · 1 из 1 источника ответил');
    expect(progressText({ found: 0, answered: 21, total: 21, pending: [], failed: [] })).toBe('Найдено 0 · 21 из 21 источника ответил');
  });
  it('after the search names the failed ones', () => {
    expect(progressText({ found: 3, answered: 2, total: 3, pending: [], failed: ['BitRu'] })).toBe(
      'Найдено 3 · 2 из 3 источников ответили · не ответили: BitRu',
    );
  });
});

describe('healthText', () => {
  it('works / fails / needs a login', () => {
    expect(healthText({ state: 'ok', ms: 800, at: 1 })).toEqual({ text: 'работает · 0,8 с', tone: 'ok' });
    expect(healthText({ state: 'ok', ms: 1234, at: 1 })).toEqual({ text: 'работает · 1,2 с', tone: 'ok' });
    expect(healthText({ state: 'ok', at: 1 })).toEqual({ text: 'работает', tone: 'ok' });
    expect(healthText({ state: 'error', at: 1 })).toEqual({ text: 'не отвечает', tone: 'bad' });
    expect(healthText({ state: 'error', at: 1, message: 'Сайт ответил ошибкой 500' })).toEqual({ text: 'не отвечает', tone: 'bad' });
    expect(healthText({ state: 'login', at: 1 })).toEqual({ text: 'нужен вход', tone: 'muted' });
    expect(healthText(null)).toBeNull();
  });
  it('a Cloudflare block shows its own text', () => {
    const m = 'Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже';
    expect(healthText({ state: 'error', at: 1, message: m })).toEqual({ text: m, tone: 'bad' });
  });
});

describe('resolveLink', () => {
  const mag = 'magnet:?xt=urn:btih:' + 'c'.repeat(40);
  it('uses the magnet of the result', async () => {
    expect(await resolveLink(res({ Magnet: mag, Link: 'https://x/page' }), ctx)).toBe(mag);
  });
  it('asks the source for the magnet from the release page', async () => {
    const magnet = vi.fn(() => Promise.resolve(mag));
    registerSource({ id: 'fake-mag', name: 'F', kind: 'builtin', search: () => Promise.resolve([]), magnet } as Source);
    const r = res({ source: 'fake-mag', detailUrl: 'https://f/t=1', Link: 'https://f/t=1' });
    expect(await resolveLink(r, ctx)).toBe(mag);
    expect(magnet).toHaveBeenCalledWith('https://f/t=1', ctx);
  });
  it('accepts an http(s) .torrent link from the source', async () => {
    registerSource({ id: 'fake-torrent', name: 'F', kind: 'builtin', search: () => Promise.resolve([]), magnet: () => Promise.resolve('https://f/download.php?id=7') });
    expect(await resolveLink(res({ source: 'fake-torrent', detailUrl: 'https://f/7' }), ctx)).toBe('https://f/download.php?id=7');
  });
  it('rejects in Russian when the source gives something else', async () => {
    registerSource({ id: 'fake-torrent', name: 'F', kind: 'builtin', search: () => Promise.resolve([]), magnet: () => Promise.resolve('javascript:alert(1)') });
    await expect(resolveLink(res({ source: 'fake-torrent', detailUrl: 'https://f/7' }), ctx)).rejects.toThrow('Не удалось получить ссылку на раздачу');
  });
  it('passes the source error through', async () => {
    registerSource({ id: 'fake-torrent', name: 'F', kind: 'builtin', search: () => Promise.resolve([]), magnet: () => Promise.reject(new Error('На странице раздачи нет magnet-ссылки')) });
    await expect(resolveLink(res({ source: 'fake-torrent', detailUrl: 'https://f/7' }), ctx)).rejects.toThrow('На странице раздачи нет magnet-ссылки');
  });
  it('falls back to Link, then the hash', async () => {
    expect(await resolveLink(res({ source: 'ts-rutor', Link: 'https://t/dl/1.torrent' }), ctx)).toBe('https://t/dl/1.torrent');
    expect(await resolveLink(res({ Hash: 'd'.repeat(40) }), ctx)).toBe('magnet:?xt=urn:btih:' + 'd'.repeat(40));
    await expect(resolveLink(res({}), ctx)).rejects.toThrow('У результата нет ссылки');
  });
});

describe('names and dates', () => {
  it('source names come from the registry', () => {
    expect(sourceName('ts-rutor')).toBe('rutor (TorrServer)');
    expect(sourceName('nope')).toBe('nope');
  });
  it('date as dd.mm.yyyy from date or CreateDate', () => {
    expect(resultDate(res({ date: new Date(2026, 9, 3, 12).getTime() }))).toBe('03.10.2026');
    expect(resultDate(res({ CreateDate: '2025-01-09T10:00:00Z' }))).toBe('09.01.2025');
    expect(resultDate(res({}))).toBe('');
  });
  it('the hint points to the Cloudflare switch and to Jackett or Prowlarr', () => {
    expect(jackettHint()).toBe('Сайт закрыт защитой Cloudflare? Для Kinozal и rustorka включите обход в «Источниках поиска», другие трекеры подключайте через Jackett или Prowlarr — как, в «Вопросах и ответах».');
  });
});

describe('fix round 1 helpers', () => {
  it('a merged row keeps the key of its first result when a better duplicate merges in', () => {
    const a = res({ source: 'nnmclub', Title: 'Film 1080p', sizeBytes: 1000, Seed: 5, detailUrl: 'https://n/1' });
    const b = res({ source: 'rutor', Title: 'Film 1080p', sizeBytes: 1000, Seed: 50, detailUrl: 'https://r/1' });
    const before = mergeResults([a]);
    const after = mergeResults([a, b]);
    expect(after).toHaveLength(1);
    expect(after[0].source).toBe('rutor');
    expect(resultKey(after[0])).toBe(resultKey(before[0]));
    expect(resultKey(after[0])).toBe('https://n/1');
  });

  it('stableOrder keeps shown rows in place and sorts only the new ones below', () => {
    const list = [res({ Title: 'a', Seed: 1, detailUrl: 'a' }), res({ Title: 'b', Seed: 100, detailUrl: 'b' }), res({ Title: 'c', Seed: 50, detailUrl: 'c' }), res({ Title: 'd', Seed: 70, detailUrl: 'd' })];
    expect(stableOrder(['a', 'c', 'gone'], list, 'seeds').map((r) => r.Title)).toEqual(['a', 'c', 'b', 'd']);
    expect(stableOrder([], list, 'seeds').map((r) => r.Title)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('seeds in words', () => {
    expect(seedsText(1)).toBe('1 сид');
    expect(seedsText(3)).toBe('3 сида');
    expect(seedsText(12)).toBe('12 сидов');
    expect(seedsText(152)).toBe('152 сида');
    expect(seedsText(312)).toBe('312 сидов');
    expect(seedsText(0)).toBe('0 сидов');
  });

  it('badge names the tracker behind Torznab', () => {
    expect(sourceBadge(res({ source: 'ts-torznab', Tracker: 'Kinozal' }))).toBe('Torznab · Kinozal');
    expect(sourceBadge(res({ source: 'ts-torznab', Tracker: '' }))).toBe('Torznab');
    expect(sourceBadge(res({ source: 'ts-rutor', Tracker: 'rutor' }))).toBe('rutor (TorrServer)');
  });

  it('recognises the Cloudflare block', () => {
    expect(isCloudflare('Сайт закрыт проверкой браузера (Cloudflare), попробуйте позже')).toBe(true);
    expect(isCloudflare('Неверный логин или пароль')).toBe(false);
    expect(isCloudflare(undefined)).toBe(false);
  });
});

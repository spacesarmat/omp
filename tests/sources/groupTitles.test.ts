import { describe, expect, it } from 'vitest';
import { groupSameTitles } from '../../src/sources/groupTitles';
import { releaseChips } from '../../src/sources/releaseRow';
import { resultBytes } from '../../src/sources/resultSize';
import type { SourceResult } from '../../src/sources/types';

const JACRED = 'Ведьмак / The Witcher / Сезон: 4 / Серии: 1-8 из 8 [2025, фэнтези, WEBRip]';
const BITMAGNET = 'The Witcher S04 2160p WEB-DL';

function row(title: string, extra?: Partial<SourceResult>): SourceResult {
  return { Title: title, Categories: '', Size: '', CreateDate: '', Tracker: '', Link: '', Magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), Hash: 'a'.repeat(40), Peer: 0, Seed: 1, source: 'x', ...extra };
}

describe('groupSameTitles', () => {
  it('keeps different languages apart until the TMDB show is known', () => {
    const groups = groupSameTitles([row(JACRED), row(BITMAGNET)]);
    expect(groups).toHaveLength(2);
  });

  it('one TMDB show and season is one group, and the poster is shared', () => {
    const show = { id: 71912, title: 'Ведьмак', poster: 'https://img/witcher.jpg' };
    const en = { id: 71912, title: 'The Witcher', poster: '' };
    const groups = groupSameTitles([row(JACRED), row(BITMAGNET)], { [JACRED]: show, [BITMAGNET]: en });
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('tv:71912:4');
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].poster).toBe('https://img/witcher.jpg');
    expect(groups[0].label).toMatch(/4 сезон/);
  });
});

describe('Witcher S04 quality chip', () => {
  it('WEBRip of 8 episodes at 5.1 GB is 720p even when the feed only wrote the size as text', () => {
    const bytes = resultBytes({ Size: '5,1 ГБ' });
    expect(bytes && bytes > 5e9).toBe(true);
    expect(releaseChips(JACRED, { sizeBytes: bytes })).toEqual(['720p', 'WEBRip']);
  });
});

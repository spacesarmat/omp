// «Мои» on the phone: the releases of one film are one card (same TMDB id, else the same normalized title and year).
import { describe, it, expect, beforeEach } from 'vitest';
import { groupPhoneLibrary, filmReleases, phoneItemHashes } from '../src/lib/filmGroups';
import { reloadProgress, saveProgress } from '../../src/store/progress';
import type { Torrent } from '../../src/api/types';

const film = (hash: string, title: string, timestamp: number): Torrent => ({ hash, title, category: 'movie', stat: 3, torrent_size: 1, timestamp });
const A1 = film('a1', 'Полуночный архив / Midnight Archive (2026) WEB-DL 1080p', 3);
const A2 = film('a2', 'Полуночный архив / Midnight Archive (2026) BDRip 2160p | Лицензия', 2);
const OLD = film('a3', 'Полуночный архив / Midnight Archive (1998) DVDRip', 1);
const OTHER = film('b1', 'Неоновые реки / Neon Rivers (2025) WEB-DL 1080p', 4);
const S1: Torrent = { hash: 's1', title: 'Тёмная материя / Dark Matter (2024) [S01] 1080p', category: 'tv', stat: 3, timestamp: 5, file_stats: [{ id: 1, path: 'S01E01.mkv', length: 1 }, { id: 2, path: 'S01E02.mkv', length: 1 }] };

beforeEach(() => {
  localStorage.clear();
  reloadProgress();
});

describe('groupPhoneLibrary', () => {
  it('two releases of the same title and year are one card; another year or film stays apart', () => {
    const items = groupPhoneLibrary([OTHER, A1, A2, OLD]);
    expect(items.map((x) => x.kind)).toEqual(['torrent', 'film', 'torrent']);
    const g = items[1];
    if (g.kind !== 'film') throw new Error('no film');
    expect(g.members.map((m) => m.hash)).toEqual(['a1', 'a2']);
    // the newest release leads the card
    expect(g.lead.hash).toBe('a1');
    expect(phoneItemHashes(items).sort()).toEqual(['a1', 'a2', 'a3', 'b1']);
  });

  it('the release watched last leads', () => {
    saveProgress('a2', 1, 600, 6000);
    const g = groupPhoneLibrary([A1, A2]).find((x) => x.kind === 'film');
    expect(g && g.kind === 'film' ? g.lead.hash : '').toBe('a2');
  });

  it('a release watched to the end still leads', () => {
    saveProgress('a2', 1, 5900, 6000);
    const g = groupPhoneLibrary([A1, A2]).find((x) => x.kind === 'film');
    expect(g && g.kind === 'film' ? g.lead.hash : '').toBe('a2');
  });

  it('a series release is never part of a film', () => {
    const S1B: Torrent = { ...S1, hash: 's1b', title: 'Тёмная материя / Dark Matter (2024) [S01] 2160p' };
    const items = groupPhoneLibrary([S1, S1B, A1, A2]);
    expect(items.filter((x) => x.kind === 'film').length).toBe(1);
    const one = items.find((x) => x.kind === 'film');
    expect(one && one.kind === 'film' ? one.members.map((m) => m.hash) : []).toEqual(['a1', 'a2']);
    expect(phoneItemHashes(items).sort()).toEqual(['a1', 'a2', 's1', 's1b']);
  });

  it('a search keeps the whole film when one release matches', () => {
    const items = groupPhoneLibrary([A1, A2, OTHER], '2160p');
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe('film');
  });
});

describe('filmReleases', () => {
  it('lists the releases of the film, itself included; none for a lone film or a series', () => {
    expect(filmReleases([A1, OTHER, A2], A2).map((x) => x.hash)).toEqual(['a1', 'a2']);
    expect(filmReleases([A1, OTHER], OTHER).map((x) => x.hash)).toEqual(['b1']);
    expect(filmReleases([S1, A1], S1)).toEqual([]);
  });
});

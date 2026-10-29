import { describe, it, expect, beforeEach } from 'vitest';
import { dataFiles, knownFiles, rememberFiles, rememberListed, resetKnownFilesForTests, KNOWN_FILES_MAX } from '../../src/lib/knownFiles';
import { TorrServerClient } from '../../src/api/torrserver';
import type { Torrent } from '../../src/api/types';

const EPS = [
  { id: 1, path: 'Show/S01E01.mkv', length: 10 },
  { id: 2, path: 'Show/S01E02.mkv', length: 11 },
];

beforeEach(() => {
  localStorage.clear();
  resetKnownFilesForTests();
});

describe('knownFiles', () => {
  it('keeps the files of a release across reloads, by hash in any case', () => {
    rememberFiles('ABC', EPS);
    resetKnownFilesForTests();
    expect(knownFiles('abc')).toEqual(EPS);
    expect(knownFiles('other')).toEqual([]);
  });

  it('remembers the list entries TorrServer shows files for and keeps none of in data', () => {
    rememberListed([
      { hash: 'seeds', data: JSON.stringify({ omp: { v: 1, h: [], ts: { s: 3, at: 1 } } }), file_stats: EPS },
      { hash: 'own', data: JSON.stringify({ TorrServer: { Files: EPS } }), file_stats: EPS },
      { hash: 'idle', data: '' },
    ]);
    expect(knownFiles('seeds')).toEqual(EPS);
    expect(knownFiles('own')).toEqual([]);
    expect(knownFiles('idle')).toEqual([]);
  });

  it('drops the oldest release past the limit', () => {
    for (let i = 0; i <= KNOWN_FILES_MAX; i++) rememberFiles('h' + i, EPS);
    expect(knownFiles('h0')).toEqual([]);
    expect(knownFiles('h' + KNOWN_FILES_MAX)).toEqual(EPS);
  });

  it('reads a corrupt store as empty', () => {
    localStorage.setItem('omp.knownFiles', '{"x":1}');
    expect(knownFiles('a')).toEqual([]);
  });

  it('dataFiles reads TorrServer.Files only', () => {
    expect(dataFiles(JSON.stringify({ TorrServer: { Files: EPS } }))).toEqual(EPS);
    expect(dataFiles('{"omp":{}}')).toEqual([]);
    expect(dataFiles('not json')).toEqual([]);
  });

  it('client.files falls back to the files seen last when the release lists none', () => {
    const c = new TorrServerClient({ url: 'http://127.0.0.1:8090' } as never);
    const idle: Torrent = { hash: 'dead', title: 'Show S01', stat: 0, data: JSON.stringify({ omp: { v: 1, h: [] } }) };
    expect(c.files(idle)).toEqual([]);
    rememberFiles('dead', EPS);
    expect(c.files(idle)).toEqual(EPS);
  });
});

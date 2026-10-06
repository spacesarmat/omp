import { describe, it, expect, afterEach } from 'vitest';
import { builtinParsers } from '../../src/sources/builtin';
import { BUILTIN_SOURCE_NAMES, rememberSourceNames, resetSourceNames } from '../../src/sources/sourceNames';
import { sourceName } from '../../src/sources/view';

afterEach(() => resetSourceNames());

describe('source names without the parsers registered (LG)', () => {
  it('the built-in table matches every parser definition', () => {
    const fromDefs: { [id: string]: string } = {};
    builtinParsers().forEach((s) => {
      fromDefs[s.id] = s.name;
    });
    expect(BUILTIN_SOURCE_NAMES).toEqual(fromDefs);
  });

  it('sourceName falls back to the built-in name, then to the id', () => {
    expect(sourceName('nnmclub')).toBe('NNM-Club');
    expect(sourceName('torrentby')).toBe('torrent.by');
    expect(sourceName('ts-rutor')).toBe('rutor (TorrServer)');
    expect(sourceName('nowhere')).toBe('nowhere');
  });

  it('names from the phone win', () => {
    rememberSourceNames([{ id: 'nnmclub', name: 'NNM' }, { id: 'jackett-1', name: 'Jackett · home' }]);
    expect(sourceName('nnmclub')).toBe('NNM');
    expect(sourceName('jackett-1')).toBe('Jackett · home');
  });
});

describe('display names of every built-in site', () => {
  it('are the sites own spellings, not ids', () => {
    expect(BUILTIN_SOURCE_NAMES).toEqual({
      rutor: 'Rutor',
      nnmclub: 'NNM-Club',
      anidub: 'Anidub',
      bigfangroup: 'BigFANGroup',
      torrentby: 'torrent.by',
      rutracker: 'RuTracker',
      kinozal: 'Kinozal',
      rustorka: 'Rustorka',
    });
    expect(['rutor', 'rutracker', 'rustorka'].map(sourceName)).toEqual(['Rutor', 'RuTracker', 'Rustorka']);
  });
});

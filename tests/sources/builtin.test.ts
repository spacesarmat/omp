import { describe, it, expect, afterEach } from 'vitest';
import { builtinParsers, registerBuiltinSources } from '../../src/sources/builtin';
import { allSources, builtinSources, unregisterSource } from '../../src/sources/registry';
import { isSourceOn, reloadSourcePrefs } from '../../src/sources/store';

afterEach(() => {
  builtinParsers().forEach((s) => unregisterSource(s.id));
});

describe('built-in sources', () => {
  it('are not registered until the Android entry point asks for them', () => {
    expect(builtinSources()).toEqual([]);
  });

  it('registers rutor, nnmclub, Anidub, BigFANGroup, torrent.by, rutracker, Kinozal and rustorka after the TorrServer sources (twice is harmless)', () => {
    registerBuiltinSources();
    registerBuiltinSources();
    expect(allSources().map((s) => s.id)).toEqual(['ts-rutor', 'ts-torznab', 'rutor', 'nnmclub', 'anidub', 'bigfangroup', 'torrentby', 'rutracker', 'kinozal', 'rustorka']);
    expect(builtinSources().every((s) => s.kind === 'builtin')).toBe(true);
  });

  it('rutracker, Kinozal and rustorka are off by default (need a login), the others on', () => {
    localStorage.removeItem('tsp.sources');
    reloadSourcePrefs();
    const on = builtinParsers().map((s) => s.id + ':' + isSourceOn(s));
    expect(on).toEqual(['rutor:true', 'nnmclub:true', 'anidub:true', 'bigfangroup:true', 'torrentby:true', 'rutracker:false', 'kinozal:false', 'rustorka:false']);
  });
});

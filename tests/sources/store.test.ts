import { describe, it, expect, beforeEach } from 'vitest';
import {
  sanitizeSourcePrefs, isSourceOn, setSourceOn, reloadSourcePrefs, enabledSources,
  getHealth, setHealth, onHealthChange, resetHealth,
} from '../../src/sources/store';
import type { Source } from '../../src/sources/types';

function src(id: string, needsLogin?: boolean): Source {
  return { id, name: id, kind: 'builtin', needsLogin, search: () => Promise.resolve([]) };
}

beforeEach(() => { localStorage.clear(); reloadSourcePrefs(); resetHealth(); });

describe('tsp.sources', () => {
  it('defaults: on, except sources that need a login', () => {
    expect(isSourceOn(src('rutor'))).toBe(true);
    expect(isSourceOn(src('rutracker', true))).toBe(false);
  });
  it('saves and reloads the switch', () => {
    setSourceOn('rutor', false);
    setSourceOn('rutracker', true);
    expect(JSON.parse(localStorage.getItem('tsp.sources')!)).toEqual({ rutor: { on: false }, rutracker: { on: true } });
    reloadSourcePrefs();
    expect(isSourceOn(src('rutor'))).toBe(false);
    expect(isSourceOn(src('rutracker', true))).toBe(true);
    expect(enabledSources([src('rutor'), src('rutracker', true), src('bitru')]).map((s) => s.id)).toEqual(['rutracker', 'bitru']);
  });
  it('sanitizes garbage', () => {
    expect(sanitizeSourcePrefs({ a: { on: true }, b: { on: 'yes' }, c: null, d: { on: false, x: 1 } }))
      .toEqual({ a: { on: true }, d: { on: false } });
    expect(sanitizeSourcePrefs([])).toEqual({});
    localStorage.setItem('tsp.sources', '[1]');
    reloadSourcePrefs();
    expect(isSourceOn(src('a'))).toBe(true);
  });
});

describe('health', () => {
  it('is kept in memory and announced', () => {
    const seen: string[] = [];
    const off = onHealthChange((id) => seen.push(id));
    expect(getHealth('rutor')).toBeNull();
    setHealth('rutor', { state: 'ok', ms: 800, at: 5 });
    expect(getHealth('rutor')).toEqual({ state: 'ok', ms: 800, at: 5 });
    off();
    setHealth('rutor', { state: 'error', at: 6 });
    expect(seen).toEqual(['rutor']);
    expect(localStorage.getItem('tsp.sources')).toBeNull();
  });
  it('resetHealth announces the cleared ids', () => {
    setHealth('a', { state: 'ok', at: 1 });
    setHealth('b', { state: 'error', at: 1 });
    const seen: string[] = [];
    const off = onHealthChange((id) => seen.push(id));
    resetHealth();
    off();
    expect(seen.sort()).toEqual(['a', 'b']);
    expect(getHealth('a')).toBeNull();
  });
});

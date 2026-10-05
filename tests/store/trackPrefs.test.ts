import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeTrackPrefs, getTrackPref, saveTrackPref, reloadTrackPrefs } from '../../src/store/trackPrefs';

beforeEach(() => { localStorage.clear(); reloadTrackPrefs(); });

describe('trackPrefs store', () => {
  it('saves, merges and persists per hash', () => {
    saveTrackPref('h', { audioLang: 'en', audioLabel: 'EN · AC3 5.1' });
    saveTrackPref('h', { sub: 'off' });
    expect(getTrackPref('h')).toEqual({ audioLang: 'en', audioLabel: 'EN · AC3 5.1', sub: 'off' });
    reloadTrackPrefs();
    expect(getTrackPref('h')!.sub).toBe('off');
    expect(getTrackPref('x')).toBeNull();
  });
  it('sanitizes garbage', () => {
    expect(sanitizeTrackPrefs({ a: { audioLang: 1, sub: 'x' }, b: null, c: { sub: { lang: 'ru', label: 'rus' } } }))
      .toEqual({ a: {}, c: { sub: { lang: 'ru', label: 'rus' } } });
    expect(sanitizeTrackPrefs([])).toEqual({});
  });
  it('keeps the player engine chosen for a torrent (builtin / vlc only)', () => {
    expect(sanitizeTrackPrefs({ a: { engine: 'vlc' }, b: { engine: 'builtin', sub: 'off' }, c: { engine: 'auto' }, d: { engine: 1 } }))
      .toEqual({ a: { engine: 'vlc' }, b: { engine: 'builtin', sub: 'off' }, c: {}, d: {} });
    saveTrackPref('h', { engine: 'vlc' });
    reloadTrackPrefs();
    expect(getTrackPref('h')).toEqual({ engine: 'vlc' });
  });
});

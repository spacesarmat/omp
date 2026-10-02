import { describe, it, expect, vi } from 'vitest';
import { tvOmpVersions, tvNeedsUpdate, tvOpensUpdate } from '../src/tv/tvUpdate';
import { saveTv, setActiveTv, reloadTvs } from '../src/tv/tvStore';
import { UPDATE_URL, ANDROID_UPDATE_URL } from '../../src/lib/updateInfo';

const feed = (version: string) => ({ version, ipkUrl: 'https://x/a.ipk', ipkHash: 'a'.repeat(64), ipkSize: 1 });

describe('tvOmpVersions', () => {
  it('reads the webOS feed for LG and the APK feed for Android TV', async () => {
    const fetchJson = vi.fn(async (_u: string) => feed('0.11.4'));
    localStorage.clear();
    reloadTvs();
    saveTv({ ip: '10.0.0.2', name: 'LG' });
    setActiveTv('10.0.0.2');
    expect(await tvOmpVersions({ installed: async () => '0.11.1', fetchJson, now: 5 })).toEqual({ installed: '0.11.1', latest: '0.11.4' });
    expect(fetchJson.mock.calls[0][0]).toBe(UPDATE_URL + '?t=5');
    saveTv({ ip: '10.0.0.3', name: 'Sony', kind: 'atv' });
    setActiveTv('10.0.0.3');
    await tvOmpVersions({ installed: async () => '0.11.1', fetchJson, now: 6 });
    expect(fetchJson.mock.calls[1][0]).toBe(ANDROID_UPDATE_URL + '?t=6');
    localStorage.clear();
    reloadTvs();
  });

  it('is quiet when the TV or the feed does not answer', async () => {
    const r = await tvOmpVersions({ installed: async () => Promise.reject(new Error('x')), fetchJson: async () => Promise.reject(new Error('y')) });
    expect(r).toEqual({ installed: null, latest: null });
    expect(await tvOmpVersions({ installed: async () => '0.11.1', fetchJson: async () => ({ bad: 1 }) })).toEqual({ installed: '0.11.1', latest: null });
  });
});

describe('tvNeedsUpdate / tvOpensUpdate', () => {
  it('compares versions', () => {
    expect(tvNeedsUpdate({ installed: '0.11.1', latest: '0.11.4' })).toBe(true);
    expect(tvNeedsUpdate({ installed: '0.11.4', latest: '0.11.4' })).toBe(false);
    expect(tvNeedsUpdate({ installed: null, latest: '0.11.4' })).toBe(false);
    expect(tvNeedsUpdate({ installed: '0.11.1', latest: null })).toBe(false);
    expect(tvOpensUpdate('0.11.3')).toBe(false);
    expect(tvOpensUpdate('0.11.4')).toBe(true);
    expect(tvOpensUpdate('0.12.0')).toBe(true);
  });
});

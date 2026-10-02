import { describe, it, expect, beforeEach } from 'vitest';
import { tvs, activeTvIp, activeTv, saveTv, forgetTv, setActiveTv, sanitizeTvs, reloadTvs } from '../src/tv/tvStore';

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
});

describe('tvStore', () => {
  it('sanitizes stored TVs', () => {
    expect(sanitizeTvs(null)).toEqual([]);
    expect(sanitizeTvs({})).toEqual([]);
    expect(
      sanitizeTvs([
        { ip: '192.168.1.5', name: 'LG', clientKey: 'k', extra: 1 },
        { ip: '192.168.1.6', name: 'LG 2', clientKey: 5 },
        { ip: 'tv.local', name: 'bad host' },
        { ip: '192.168.1.7' },
        'junk',
      ]),
    ).toEqual([
      { ip: '192.168.1.5', name: 'LG', clientKey: 'k' },
      { ip: '192.168.1.6', name: 'LG 2' },
    ]);
  });

  it('saves a TV, makes the first one active and persists', () => {
    saveTv({ ip: '192.168.1.5', name: 'LG' });
    expect(tvs.value).toEqual([{ ip: '192.168.1.5', name: 'LG' }]);
    expect(activeTvIp.value).toBe('192.168.1.5');
    expect(activeTv.value?.name).toBe('LG');
    expect(JSON.parse(localStorage.getItem('tsp.tvs')!)).toEqual([{ ip: '192.168.1.5', name: 'LG' }]);
    expect(JSON.parse(localStorage.getItem('tsp.activeTv')!)).toBe('192.168.1.5');
  });

  it('updates an existing TV and keeps its key', () => {
    saveTv({ ip: '192.168.1.5', name: 'LG', clientKey: 'K' });
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    expect(tvs.value).toEqual([{ ip: '192.168.1.5', name: 'LG OLED', clientKey: 'K' }]);
    saveTv({ ip: '192.168.1.5', name: 'LG OLED', clientKey: 'K2' });
    expect(tvs.value[0].clientKey).toBe('K2');
  });

  it('selects the active TV', () => {
    saveTv({ ip: '192.168.1.5', name: 'A' });
    saveTv({ ip: '192.168.1.6', name: 'B' });
    expect(activeTvIp.value).toBe('192.168.1.5');
    setActiveTv('192.168.1.6');
    expect(activeTv.value?.name).toBe('B');
    expect(JSON.parse(localStorage.getItem('tsp.activeTv')!)).toBe('192.168.1.6');
    setActiveTv('10.0.0.1');
    expect(activeTvIp.value).toBe('192.168.1.6');
  });

  it('forgets a TV and moves the active one', () => {
    saveTv({ ip: '192.168.1.5', name: 'A' });
    saveTv({ ip: '192.168.1.6', name: 'B' });
    forgetTv('192.168.1.5');
    expect(tvs.value.map((t) => t.ip)).toEqual(['192.168.1.6']);
    expect(activeTvIp.value).toBe('192.168.1.6');
    forgetTv('192.168.1.6');
    expect(tvs.value).toEqual([]);
    expect(activeTv.value).toBeNull();
  });

  it('loads saved TVs and drops a corrupt active value', () => {
    localStorage.setItem('tsp.tvs', JSON.stringify([{ ip: '192.168.1.9', name: 'Saved' }]));
    localStorage.setItem('tsp.activeTv', '42');
    reloadTvs();
    expect(tvs.value).toEqual([{ ip: '192.168.1.9', name: 'Saved' }]);
    expect(activeTvIp.value).toBeNull();
  });
});

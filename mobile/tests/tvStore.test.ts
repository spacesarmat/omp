import { describe, it, expect, beforeEach } from 'vitest';
import { tvs, activeTvIp, activeTv, saveTv, forgetTv, setActiveTv, sanitizeTvs, reloadTvs, renameTv, normalizeMac } from '../src/tv/tvStore';

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
    expect(tvs.value).toEqual([{ ip: '192.168.1.5', name: 'LG', defaultName: 'LG' }]);
    expect(activeTvIp.value).toBe('192.168.1.5');
    expect(activeTv.value?.name).toBe('LG');
    expect(JSON.parse(localStorage.getItem('tsp.tvs')!)).toEqual([{ ip: '192.168.1.5', name: 'LG', defaultName: 'LG' }]);
    expect(JSON.parse(localStorage.getItem('tsp.activeTv')!)).toBe('192.168.1.5');
  });

  it('updates an existing TV and keeps its key', () => {
    saveTv({ ip: '192.168.1.5', name: 'LG', clientKey: 'K' });
    saveTv({ ip: '192.168.1.5', name: 'LG OLED' });
    expect(tvs.value).toEqual([{ ip: '192.168.1.5', name: 'LG OLED', defaultName: 'LG OLED', clientKey: 'K' }]);
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

  it('renames a TV, keeps the default name and restores it on empty input', () => {
    saveTv({ ip: '192.168.1.5', name: '[LG] webOS TV', clientKey: 'k' });
    renameTv('192.168.1.5', '  Гостиная  ');
    expect(tvs.value[0].name).toBe('Гостиная');
    expect(tvs.value[0].defaultName).toBe('[LG] webOS TV');
    expect(JSON.parse(localStorage.getItem('tsp.tvs')!)[0].name).toBe('Гостиная');
    renameTv('192.168.1.5', 'x'.repeat(60));
    expect(tvs.value[0].name).toHaveLength(40);
    renameTv('192.168.1.5', '   ');
    expect(tvs.value[0].name).toBe('[LG] webOS TV');
  });

  it('does not overwrite a user name when the TV is saved again', () => {
    saveTv({ ip: '192.168.1.5', name: '[LG] webOS TV' });
    renameTv('192.168.1.5', 'Гостиная');
    saveTv({ ip: '192.168.1.5', name: '[LG] webOS TV OLED', clientKey: 'k2' });
    saveTv({ ip: '192.168.1.5', name: 'Гостиная', clientKey: 'k2' });
    expect(tvs.value[0].name).toBe('Гостиная');
    expect(tvs.value[0].defaultName).toBe('[LG] webOS TV');
    expect(tvs.value[0].clientKey).toBe('k2');
  });

  it('keeps following the discovered name while not renamed', () => {
    saveTv({ ip: '192.168.1.5', name: 'A' });
    saveTv({ ip: '192.168.1.5', name: 'B' });
    expect(tvs.value[0].name).toBe('B');
    expect(tvs.value[0].defaultName).toBe('B');
  });

  it('sanitizes defaultName', () => {
    expect(sanitizeTvs([{ ip: '192.168.1.5', name: 'N', defaultName: 'D' }, { ip: '192.168.1.6', name: 'N', defaultName: 5 }])).toEqual([
      { ip: '192.168.1.5', name: 'N', defaultName: 'D' },
      { ip: '192.168.1.6', name: 'N' },
    ]);
  });

  describe('port', () => {
    it('sanitizer keeps only 3000 and 3001', () => {
      const out = sanitizeTvs([
        { ip: '10.0.0.1', name: 'A', port: 3001 },
        { ip: '10.0.0.2', name: 'B', port: 3000 },
        { ip: '10.0.0.3', name: 'C', port: 8080 },
        { ip: '10.0.0.4', name: 'D', port: '3000' },
      ]);
      expect(out.map((t) => t.port)).toEqual([3001, 3000, undefined, undefined]);
    });

    it('saveTv stores the port and keeps it when a later save has none', () => {
      saveTv({ ip: '10.0.0.1', name: 'A', port: 3001 });
      saveTv({ ip: '10.0.0.1', name: 'A' });
      expect(tvs.value[0].port).toBe(3001);
      saveTv({ ip: '10.0.0.1', name: 'A', port: 3000 });
      expect(tvs.value[0].port).toBe(3000);
    });
  });
});

describe('mac', () => {
  beforeEach(() => {
    localStorage.clear();
    reloadTvs();
  });

  it('normalises common MAC spellings', () => {
    expect(normalizeMac('AA-BB-CC-DD-EE-FF')).toBe('aa:bb:cc:dd:ee:ff');
    expect(normalizeMac('aabbccddeeff')).toBe('aa:bb:cc:dd:ee:ff');
    expect(normalizeMac('AA:bb:CC:dd:EE:ff')).toBe('aa:bb:cc:dd:ee:ff');
    expect(normalizeMac('aa:bb')).toBeUndefined();
    expect(normalizeMac('zz:bb:cc:dd:ee:ff')).toBeUndefined();
    expect(normalizeMac(5)).toBeUndefined();
  });

  it('sanitizeTvs keeps only a well-formed lower-case MAC', () => {
    const out = sanitizeTvs([
      { ip: '192.168.1.5', name: 'A', mac: 'aa:bb:cc:dd:ee:ff' },
      { ip: '192.168.1.6', name: 'B', mac: 'AA:BB:CC:DD:EE:FF' },
      { ip: '192.168.1.7', name: 'C', mac: 7 },
    ]);
    expect(out.map((t) => t.mac)).toEqual(['aa:bb:cc:dd:ee:ff', undefined, undefined]);
  });

  it('saveTv keeps the MAC when a later save has none', () => {
    saveTv({ ip: '192.168.1.5', name: 'LG', mac: 'aa:bb:cc:dd:ee:ff' });
    saveTv({ ip: '192.168.1.5', name: 'LG', clientKey: 'K' });
    expect(tvs.value[0].mac).toBe('aa:bb:cc:dd:ee:ff');
    saveTv({ ip: '192.168.1.5', name: 'LG', mac: '11:22:33:44:55:66' });
    expect(tvs.value[0].mac).toBe('11:22:33:44:55:66');
  });
});

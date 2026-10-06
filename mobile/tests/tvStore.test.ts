import { describe, it, expect, beforeEach } from 'vitest';
import { tvs, activeTvIp, activeTv, saveTv, forgetTv, setActiveTv, sanitizeTvs, reloadTvs, renameTv, normalizeMac, clearTvToken, pickActiveTv } from '../src/tv/tvStore';

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

  it('clears a dead Android TV token, but not a newer one', () => {
    const A = 'a'.repeat(32);
    const B = 'b'.repeat(32);
    saveTv({ ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: A, ctlPort: 8095 });
    clearTvToken('192.168.1.40', B);
    expect(tvs.value[0].token).toBe(A);
    clearTvToken('192.168.1.40', A);
    expect(tvs.value[0]).toEqual({ ip: '192.168.1.40', name: 'Гостиная', defaultName: 'Гостиная', kind: 'atv', ctlPort: 8095 });
    reloadTvs();
    expect(tvs.value[0].token).toBeUndefined();
    saveTv({ ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: B });
    expect(tvs.value[0].token).toBe(B);
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

  it('sanitizeTvs keeps Android TVs with a token and a control port, LG stays without kind', () => {
    const token = '0123456789abcdef0123456789abcdef';
    const out = sanitizeTvs([
      { ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token, ctlPort: 8095, clientKey: 'x', port: 3000, mac: 'aa:bb:cc:dd:ee:ff' },
      { ip: '192.168.1.41', name: 'Bad token', kind: 'atv', token: 'XYZ', ctlPort: 70000 },
      { ip: '192.168.1.42', name: 'Odd kind', kind: 'tizen' },
      { ip: '192.168.1.43', name: 'LG', kind: 'lg', port: 3001 },
    ]);
    expect(out).toEqual([
      { ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token, ctlPort: 8095 },
      { ip: '192.168.1.41', name: 'Bad token', kind: 'atv' },
      { ip: '192.168.1.42', name: 'Odd kind' },
      { ip: '192.168.1.43', name: 'LG', port: 3001 },
    ]);
  });

  it('saveTv stores an Android TV with its token and keeps them on a later save', () => {
    const token = 'ffffffffffffffffffffffffffffffff';
    saveTv({ ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token, ctlPort: 8095 });
    expect(tvs.value).toEqual([
      { ip: '192.168.1.40', name: 'Гостиная', defaultName: 'Гостиная', kind: 'atv', token, ctlPort: 8095 },
    ]);
    saveTv({ ip: '192.168.1.40', name: 'Гостиная' });
    expect(tvs.value[0]).toMatchObject({ kind: 'atv', token, ctlPort: 8095 });
    const t2 = '11111111111111111111111111111111';
    saveTv({ ip: '192.168.1.40', name: 'Гостиная', kind: 'atv', token: t2 });
    expect(tvs.value[0].token).toBe(t2);
    reloadTvs();
    expect(tvs.value[0]).toMatchObject({ kind: 'atv', token: t2, ctlPort: 8095 });
  });
});

describe('the TV the remote uses', () => {
  const LG = { ip: '192.168.1.156', name: 'LG', clientKey: 'k', usedAt: 100 };
  const DUNE = { ip: '192.168.1.191', name: 'Dune', kind: 'atv' as const, token: 'a'.repeat(32), usedAt: 200 };
  const OLD = { ip: '192.168.1.7', name: 'Old' };

  it('the active one; else the last used saved one; else the first; none only without saved TVs', () => {
    expect(pickActiveTv([LG, DUNE], LG.ip)).toBe(LG);
    // the active IP names no saved TV (replaced) or none is set (install assistant): the last used one
    expect(pickActiveTv([LG, DUNE], '10.0.0.1')).toBe(DUNE);
    expect(pickActiveTv([LG, DUNE], null)).toBe(DUNE);
    expect(pickActiveTv([OLD, LG], null)).toBe(LG);
    expect(pickActiveTv([OLD], null)).toBe(OLD);
    expect(pickActiveTv([], null)).toBeNull();
  });

  it('a TV saved without being made active (install assistant) is still the remote\'s TV, and keeps its key', () => {
    saveTv({ ip: LG.ip, name: 'LG', clientKey: 'k' }, { keepActive: true });
    expect(activeTvIp.value).toBeNull();
    expect(activeTv.value).toMatchObject({ ip: LG.ip, clientKey: 'k' });
  });

  it('making a TV active stamps it as used; the stamp survives a reload and an update of the TV', () => {
    saveTv({ ip: LG.ip, name: 'LG', clientKey: 'k' });
    saveTv({ ip: DUNE.ip, name: 'Dune', kind: 'atv', token: DUNE.token });
    setActiveTv(DUNE.ip, 500);
    saveTv({ ip: DUNE.ip, name: 'Dune HD', kind: 'atv' });
    expect(tvs.value[1]).toMatchObject({ usedAt: 500, token: DUNE.token });
    // the active value lost (as after a restore naming a TV that is gone): the Dune, last used, is the remote's TV
    localStorage.setItem('tsp.activeTv', JSON.stringify('10.0.0.9'));
    reloadTvs();
    expect(activeTv.value).toMatchObject({ ip: DUNE.ip, token: DUNE.token });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mergeDevices,
  castKind,
  searchDevices,
  setInstallNative,
  deviceFor,
  rememberDevice,
  type InstallNative,
} from '../src/install/devices';
import { reloadTvs, saveTv } from '../src/tv/tvStore';
import { clearLog, logEntries } from '../../src/lib/log';

function fakeNative(o: Partial<InstallNative> = {}): InstallNative {
  return {
    discoverTvs: async () => [],
    discoverCastTvs: async () => [],
    discoverOmpTvs: async () => [],
    probePorts: async () => [],
    stopDiscovery: async () => {},
    ...o,
  };
}

beforeEach(() => {
  localStorage.clear();
  reloadTvs();
  clearLog();
});

afterEach(() => setInstallNative(null));

describe('castKind', () => {
  it('sorts cast models', () => {
    expect(castKind('Google Home Mini')).toBe('speaker');
    expect(castKind('Nest Audio')).toBe('speaker');
    expect(castKind('Google Cast Group')).toBe('speaker');
    expect(castKind('Chromecast Audio')).toBe('speaker');
    expect(castKind('Chromecast Ultra')).toBe('chromecast');
    expect(castKind('Chromecast')).toBe('tv');
    expect(castKind('Chromecast HD')).toBe('tv');
    expect(castKind('BRAVIA 4K VH2')).toBe('tv');
    expect(castKind(undefined)).toBe('tv');
  });
});

describe('mergeDevices', () => {
  it('one entry per IP: LG wins over cast, OMP joins the cast entry', () => {
    const list = mergeDevices(
      {
        lg: [{ ip: '192.168.1.5', name: 'LG «Гостиная»', model: 'OLED55C1' }],
        cast: [
          { ip: '192.168.1.5', name: 'Same IP', model: 'X' },
          { ip: '192.168.1.9', name: 'Спальня', model: 'Chromecast HD' },
          { ip: '192.168.1.11', name: 'Колонка', model: 'Nest Audio' },
        ],
        omp: [
          { ip: '192.168.1.9', port: 8095, name: 'OMP name', version: '0.12.0' },
          { ip: '192.168.1.5', port: 8095, name: 'ignored', version: '9.9' },
          { ip: '192.168.1.20', port: 8096, name: 'Кухня', version: '0.13.1' },
        ],
      },
      [],
    );
    expect(list).toEqual([
      { ip: '192.168.1.5', name: 'LG «Гостиная»', kind: 'lg', model: 'OLED55C1', online: true },
      { ip: '192.168.1.9', name: 'Спальня', kind: 'atv', cast: 'tv', model: 'Chromecast HD', ompVersion: '0.12.0', ompPort: 8095, online: true },
      { ip: '192.168.1.20', name: 'Кухня', kind: 'atv', ompVersion: '0.13.1', ompPort: 8096, online: true },
    ]);
  });

  it('keeps user names of saved TVs and adds saved TVs that did not answer', () => {
    const list = mergeDevices({ lg: [{ ip: '192.168.1.5', name: 'LG webOS TV' }] }, [
      { ip: '192.168.1.5', name: 'Моя гостиная', kind: 'lg' },
      { ip: '192.168.1.40', name: 'Приставка', kind: 'atv' },
    ]);
    expect(list).toEqual([
      { ip: '192.168.1.5', name: 'Моя гостиная', kind: 'lg', saved: true, online: true },
      { ip: '192.168.1.40', name: 'Приставка', kind: 'atv', saved: true, online: false },
    ]);
  });

  it('dedupes repeated entries of one search', () => {
    const list = mergeDevices({ lg: [{ ip: '1.1.1.1', name: 'A' }, { ip: '1.1.1.1', name: 'B' }] }, []);
    expect(list.map((d) => d.name)).toEqual(['A']);
  });
});

describe('searchDevices', () => {
  it('merges the three searches and reports each as it arrives', async () => {
    let releaseLg!: () => void;
    setInstallNative(
      fakeNative({
        discoverTvs: () => new Promise((r) => (releaseLg = () => r([{ ip: '192.168.1.5', name: 'LG' }]))),
        discoverCastTvs: async () => [{ ip: '192.168.1.9', name: 'Спальня', model: 'Chromecast HD' }],
      }),
    );
    const updates: number[] = [];
    const done = searchDevices((l) => updates.push(l.length));
    await new Promise((r) => setTimeout(r, 0));
    expect(updates[updates.length - 1]).toBe(1);
    releaseLg();
    const list = await done;
    expect(list.map((d) => d.ip)).toEqual(['192.168.1.5', '192.168.1.9']);
    expect(deviceFor('192.168.1.9').name).toBe('Спальня');
  });

  it('a failed search is logged without names or addresses and the rest still shows', async () => {
    setInstallNative(
      fakeNative({
        discoverCastTvs: async () => {
          throw new Error('192.168.1.9 Спальня broke');
        },
        discoverOmpTvs: async () => [{ ip: '192.168.1.20', port: 8095, name: 'Кухня', version: '0.13.1' }],
      }),
    );
    const list = await searchDevices(() => {});
    expect(list.map((d) => d.ip)).toEqual(['192.168.1.20']);
    const e = logEntries().find((x) => x.a === 'install')!;
    expect(e.l).toBe('warn');
    expect(e.x).toBe('Поиск Android TV не удался');
  });
});

describe('deviceFor', () => {
  it('falls back to a saved TV, then to a bare device of the kind', () => {
    saveTv({ ip: '192.168.1.77', name: 'Сохранённый' });
    expect(deviceFor('192.168.1.77')).toEqual({ ip: '192.168.1.77', name: 'Сохранённый', kind: 'lg', saved: true, online: false });
    expect(deviceFor('192.168.1.78', 'atv')).toEqual({ ip: '192.168.1.78', name: 'Android TV 192.168.1.78', kind: 'atv', online: false });
    rememberDevice({ ip: '192.168.1.79', name: 'Найден', kind: 'atv', online: true });
    expect(deviceFor('192.168.1.79', 'atv').name).toBe('Найден');
    // a manual entry of another kind wins over the remembered one
    expect(deviceFor('192.168.1.79', 'lg').kind).toBe('lg');
  });
});

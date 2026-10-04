import { describe, it, expect, beforeEach } from 'vitest';
import {
  candidateWhere,
  identifyIndexer,
  INDEXER_PORTS,
  INSECURE_KEY,
  isLanHost,
  kindByPort,
  lastScan,
  mergeCandidates,
  plainHttpWarning,
  readTorznabImports,
  scanDue,
  scanIndexers,
  SCAN_EVERY_MS,
  torznabBase,
  torznabFromSettings,
  type LanHit,
} from '../../src/sources/indexerDiscovery';
import { hidesTorznab } from '../../src/sources/indexer';
import { reloadIndexers, torznabHosts, type IndexerConn } from '../../src/sources/indexerStore';
import { reloadSourcePrefs, setSourceOn } from '../../src/sources/store';
import { fakeSite, page, type HttpCall } from './fakeSite';

// test-only key
const KEY = 'test0only0key0000000000000000abc';
const NOW = 1_800_000_000_000;

beforeEach(() => {
  localStorage.clear();
  reloadIndexers();
  reloadSourcePrefs();
});

/** A home network: Jackett on .5:9117, Prowlarr on .7:9696, something else on .9:9117. */
function lan(c: HttpCall) {
  if (c.url === 'http://192.168.1.5:9117/') return page('<html><head><title>Jackett</title></head></html>', 'http://192.168.1.5:9117/UI/Dashboard');
  if (c.url === 'http://192.168.1.7:9696/') return page('<html><head><title>Prowlarr</title></head><script>window.Prowlarr = {}</script></html>', c.url);
  if (c.url === 'http://192.168.1.9:9117/') return page('<html><title>Router</title></html>', c.url);
  if (c.url === 'http://192.168.1.9:9117/api/v2.0/server/config') return page('', c.url, 404);
  return page('', c.url, 404);
}

describe('identification', () => {
  it('tells Jackett and Prowlarr by their start page', async () => {
    const site = fakeSite(lan);
    expect(await identifyIndexer('http://192.168.1.5:9117', site.ctx.http)).toBe('jackett');
    expect(await identifyIndexer('http://192.168.1.7:9696', site.ctx.http)).toBe('prowlarr');
    expect(await identifyIndexer('http://192.168.1.9:9117', site.ctx.http)).toBeNull();
  });

  it('falls back to the API answer on the usual port; a dead host is null', async () => {
    const site = fakeSite((c) => {
      if (c.url.endsWith('/api/v1/system/status')) return page('', c.url, 401);
      if (c.url.endsWith('/api/v2.0/server/config')) return page('', 'http://h:9117/UI/Login');
      return page('', c.url);
    });
    expect(await identifyIndexer('http://192.168.1.7:9696', site.ctx.http)).toBe('prowlarr');
    expect(await identifyIndexer('http://192.168.1.5:9117', site.ctx.http)).toBe('jackett');
    expect(await identifyIndexer('http://192.168.1.5:8080', site.ctx.http)).toBeNull();
    const dead = fakeSite(() => {
      throw new Error('refused');
    });
    expect(await identifyIndexer('http://192.168.1.5:9117', dead.ctx.http)).toBeNull();
    expect(kindByPort('http://h:9117')).toBe('jackett');
    expect(kindByPort('http://h:9696/x')).toBe('prowlarr');
    expect(kindByPort('http://h')).toBeNull();
  });
});

describe('LAN scan', () => {
  it('asks only the two ports, ignores foreign hits, dedupes and identifies with bounded concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const site = fakeSite((c) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise((r) =>
        setTimeout(() => {
          inFlight--;
          r(lan(c));
        }, 1),
      );
    });
    let asked: number[] = [];
    const hits: LanHit[] = [
      { ip: '192.168.1.5', port: 9117 },
      { ip: '192.168.1.5', port: 9117 },
      { ip: '192.168.1.7', port: 9696 },
      { ip: '192.168.1.9', port: 9117 },
      { ip: '8.8.8.8', port: 9117 },
      { ip: '192.168.1.5', port: 22 },
    ];
    for (let i = 20; i < 40; i++) hits.push({ ip: '192.168.1.' + i, port: 9696 });
    const found = await scanIndexers(
      (ports) => {
        asked = ports;
        return Promise.resolve(hits);
      },
      site.ctx.http,
      () => NOW,
    );
    expect(asked).toEqual(INDEXER_PORTS);
    expect(found).toEqual([
      { kind: 'jackett', url: 'http://192.168.1.5:9117' },
      { kind: 'prowlarr', url: 'http://192.168.1.7:9696' },
    ]);
    expect(peak).toBeLessThanOrEqual(4);
    expect(site.calls.some((c) => c.url.indexOf('8.8.8.8') >= 0 || c.url.indexOf(':22') >= 0)).toBe(false);
    expect(site.calls.filter((c) => c.url === 'http://192.168.1.5:9117/')).toHaveLength(1);
    expect(lastScan()).toEqual({ at: NOW, found });
  });

  it('runs automatically at most once a day; a failed native scan also waits', async () => {
    expect(scanDue(NOW)).toBe(true);
    await scanIndexers(() => Promise.reject(new Error('off-device')), fakeSite(lan).ctx.http, () => NOW);
    expect(lastScan()).toEqual({ at: NOW, found: [] });
    expect(scanDue(NOW + 1000)).toBe(false);
    expect(scanDue(NOW + SCAN_EVERY_MS - 1)).toBe(false);
    expect(scanDue(NOW + SCAN_EVERY_MS)).toBe(true);
    // the clock went back
    expect(scanDue(NOW - 1000)).toBe(true);
  });

  it('a stored record is sanitized', () => {
    localStorage.setItem('tsp.indexerScan', JSON.stringify({ at: NOW, found: [{ kind: 'jackett', url: 'http://h:9117/', apiKey: KEY }, { kind: 'x', url: 'y' }] }));
    expect(lastScan()).toEqual({ at: NOW, found: [{ kind: 'jackett', url: 'http://h:9117' }] });
    localStorage.setItem('tsp.indexerScan', '"junk"');
    expect(lastScan()).toBeNull();
  });
});

describe('TorrServer settings', () => {
  const settings = {
    CacheSize: 1,
    EnableTorznabSearch: true,
    TorznabUrls: [
      { Host: 'http://192.168.1.5:9117/api/v2.0/indexers/all/results/torznab/', Key: KEY, Name: 'Jackett' },
      { Host: 'http://192.168.1.7:9696/3/api', Key: KEY },
      { Host: 'http://192.168.1.7:9696/4/api', Key: KEY },
      { Host: 'http://nas.local:8000', Key: 'bad key with spaces' },
      { Host: 'not an address' },
      'junk',
    ],
  };

  it('finds the base addresses, kinds and keys', () => {
    expect(torznabBase('http://H:9117/api/v2.0/indexers/all/results/torznab')).toEqual({ url: 'http://h:9117', kind: 'jackett' });
    expect(torznabBase('http://h:9696/12/')).toEqual({ url: 'http://h:9696', kind: 'prowlarr' });
    expect(torznabBase('https://proxy.example/jackett/api/v2.0/indexers/x')).toEqual({ url: 'https://proxy.example/jackett', kind: 'jackett' });
    expect(torznabBase('http://h:1234/x')).toEqual({ url: 'http://h:1234/x', kind: null });
    const t = torznabFromSettings(settings)!;
    expect(t.enabled).toBe(true);
    expect(t.hosts).toEqual(['192.168.1.5:9117', '192.168.1.7:9696', 'nas.local:8000']);
    expect(t.imports).toEqual([
      { url: 'http://192.168.1.5:9117', kind: 'jackett', key: KEY },
      { url: 'http://192.168.1.7:9696', kind: 'prowlarr', key: KEY },
      { url: 'http://nas.local:8000', kind: null, key: '' },
    ]);
  });

  it('Torznab off or an old server without the list', () => {
    expect(torznabFromSettings({ ...settings, EnableTorznabSearch: false })).toEqual({ enabled: false, hosts: [], imports: [] });
    expect(torznabFromSettings({ CacheSize: 1 })).toBeNull();
    expect(torznabFromSettings(null)).toBeNull();
  });

  it('reading the settings records the hosts (never keys) for the path selection', async () => {
    expect(torznabHosts()).toBeUndefined();
    const imports = await readTorznabImports(() => Promise.resolve(settings));
    expect(imports).toHaveLength(3);
    expect(torznabHosts()).toEqual(['192.168.1.5:9117', '192.168.1.7:9696', 'nas.local:8000']);
    expect(localStorage.getItem('tsp.torznabHosts')).not.toContain(KEY);
    // an old server leaves what is known; a failure too
    await readTorznabImports(() => Promise.resolve({ CacheSize: 1 }));
    await readTorznabImports(() => Promise.reject(new Error('x')));
    expect(torznabHosts()).toHaveLength(3);
    expect(await readTorznabImports(null)).toEqual([]);
    reloadIndexers();
    expect(torznabHosts()).toHaveLength(3);
  });
});

describe('path selection with the TorrServer hosts', () => {
  const j: IndexerConn = { id: 'jackett-1', kind: 'jackett', url: 'http://192.168.1.5:9117', keySet: true };
  const p: IndexerConn = { id: 'prowlarr-1', kind: 'prowlarr', url: 'http://192.168.1.7:9696', keySet: true };

  it('hidden only when every TorrServer Torznab host is connected directly', () => {
    expect(hidesTorznab([j], ['192.168.1.5:9117'])).toBe(true);
    expect(hidesTorznab([j], ['192.168.1.5:9117', '192.168.1.7:9696'])).toBe(false);
    expect(hidesTorznab([j, p], ['192.168.1.5:9117', '192.168.1.7:9696'])).toBe(true);
    // TorrServer has no Torznab address: any direct connection
    expect(hidesTorznab([p], [])).toBe(true);
    expect(hidesTorznab([], [])).toBe(false);
    // unknown: a direct Jackett
    expect(hidesTorznab([p])).toBe(false);
    setSourceOn('indexer-jackett-1', false);
    expect(hidesTorznab([j], ['192.168.1.5:9117'])).toBe(false);
  });
});

describe('merge', () => {
  it('one row per host:port; saved connection, TorrServer key and LAN find combine', () => {
    const conns: IndexerConn[] = [{ id: 'jackett-1', kind: 'jackett', url: 'http://192.168.1.5:9117', keySet: true }];
    const list = mergeCandidates(
      conns,
      [
        { kind: 'jackett', url: 'http://192.168.1.5:9117' },
        { kind: 'prowlarr', url: 'http://192.168.1.7:9696' },
      ],
      [
        { url: 'http://192.168.1.5:9117', kind: 'jackett', key: KEY },
        { url: 'http://nas.local:8000', kind: null, key: '' },
        { url: 'http://192.168.1.7:9696', kind: null, key: KEY },
      ],
    );
    expect(list.map((c) => [c.host, c.kind, c.network, c.torrserver, !!c.tsKey, c.connId || ''])).toEqual([
      ['192.168.1.5:9117', 'jackett', true, true, true, 'jackett-1'],
      ['nas.local:8000', null, false, true, false, ''],
      ['192.168.1.7:9696', 'prowlarr', true, true, true, ''],
    ]);
    expect(candidateWhere(list[2])).toBe('192.168.1.7:9696 · ключ из TorrServer');
    expect(candidateWhere(list[1])).toBe('nas.local:8000 · в настройках TorrServer');
    expect(candidateWhere({ kind: 'prowlarr', url: 'http://h:9696', host: 'h:9696', network: true, torrserver: false })).toBe('h:9696 · найден в сети');
  });
});

describe('plain http warning', () => {
  it('only for http outside the home network', () => {
    expect(plainHttpWarning('http://my-seedbox.example.com:9117')).toBe(INSECURE_KEY);
    expect(INSECURE_KEY).toContain('ключ передаётся без шифрования');
    expect(plainHttpWarning('http://8.8.8.8:9117')).toBe(INSECURE_KEY);
    expect(plainHttpWarning('http://172.32.0.1:9117')).toBe(INSECURE_KEY);
    for (const u of ['http://192.168.1.5:9117', 'http://10.0.0.2:9696', 'http://172.16.0.1', 'http://172.31.255.1', 'http://nas.local:9117', 'http://localhost:9117', 'http://127.0.0.1:9117', 'https://my-seedbox.example.com', '']) {
      expect(plainHttpWarning(u)).toBe('');
    }
    expect(isLanHost('NAS.LOCAL')).toBe(true);
  });
});

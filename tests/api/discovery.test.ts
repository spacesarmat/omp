import { describe, it, expect, afterEach } from 'vitest';
import { subnetOf, candidateSubnets, discover, probeEcho, getLocalIp } from '../../src/api/discovery';

describe('subnet helpers', () => {
  it('subnetOf', () => {
    expect(subnetOf('192.168.1.191')).toBe('192.168.1');
    expect(subnetOf('bad')).toBeNull();
  });
  it('candidateSubnets dedups and orders', () => {
    expect(candidateSubnets('10.0.0.7', ['http://192.168.1.191:5665', 'http://10.0.0.2:8090'])).toEqual([
      '10.0.0', '192.168.1', '192.168.0',
    ]);
    expect(candidateSubnets(null, [])).toEqual(['192.168.1', '192.168.0']);
  });
});

describe('discover', () => {
  it('scans hosts and ports with injected probe', async () => {
    const progress: number[] = [];
    const found = await discover({
      subnets: ['10.0.0'],
      probe: (url) => Promise.resolve(url === 'http://10.0.0.5:8090' ? 'MatriX.145.1' : null),
      onProgress: (done, total) => { if (done === total) progress.push(total); },
    });
    expect(found).toEqual([{ url: 'http://10.0.0.5:8090', version: 'MatriX.145.1' }]);
    expect(progress).toEqual([508]);
  });
  it('treats probe rejection as miss', async () => {
    const found = await discover({ subnets: ['10.0.1'], ports: [8090], probe: () => Promise.reject(new Error('x')) });
    expect(found).toEqual([]);
  });
});

class FakeXHR {
  static instances: FakeXHR[] = [];
  method = ''; url = ''; responseType = ''; timeout = 0; status = 0; responseText = ''; response: any = '';
  aborted = false; sent = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() { FakeXHR.instances.push(this); }
  open(m: string, u: string) { this.method = m; this.url = u; }
  send() { this.sent = true; }
  abort() { this.aborted = true; if (this.onabort) this.onabort(); }
  respond(status: number, body: string) { this.status = status; this.responseText = body; this.response = body; if (this.onload) this.onload(); }
}

describe('probeEcho (XHR)', () => {
  const orig = (window as any).XMLHttpRequest;
  const install = () => { FakeXHR.instances = []; (window as any).XMLHttpRequest = FakeXHR; };
  afterEach(() => { (window as any).XMLHttpRequest = orig; });

  it('resolves trimmed version and sets native timeout', async () => {
    install();
    const p = probeEcho('http://10.0.0.5:8090', 1200);
    const x = FakeXHR.instances[0];
    expect(x.method).toBe('GET');
    expect(x.url).toBe('http://10.0.0.5:8090/echo');
    expect(x.timeout).toBe(1200);
    expect(x.responseType).toBe('text');
    expect(x.sent).toBe(true);
    x.respond(200, ' MatriX.145.1 ');
    expect(await p).toBe('MatriX.145.1');
  });
  it('resolves null on non-2xx', async () => {
    install();
    const p = probeEcho('http://a', 100);
    FakeXHR.instances[0].respond(404, 'nope');
    expect(await p).toBeNull();
  });
  it('resolves null on timeout and error', async () => {
    install();
    const p = probeEcho('http://a', 100);
    FakeXHR.instances[0].ontimeout!();
    expect(await p).toBeNull();
    const p2 = probeEcho('http://b', 100);
    FakeXHR.instances[1].onerror!();
    expect(await p2).toBeNull();
  });
  it('resolves null on bad body', async () => {
    install();
    for (const body of ['', '<html></html>', 'x'.repeat(64)]) {
      const p = probeEcho('http://a', 100);
      FakeXHR.instances[FakeXHR.instances.length - 1].respond(200, body);
      expect(await p).toBeNull();
    }
  });
  it('register hook aborts the request', async () => {
    install();
    let abort: (() => void) | null = null;
    const p = probeEcho('http://a', 100, (fn) => { abort = fn; });
    expect(abort).toBeTypeOf('function');
    abort!();
    expect(FakeXHR.instances[0].aborted).toBe(true);
    expect(await p).toBeNull();
  });
});

describe('discover bounds and cancellation', () => {
  it('never exceeds concurrency in flight', async () => {
    let inFlight = 0;
    let max = 0;
    const found = await discover({
      subnets: ['10.0.2'],
      concurrency: 5,
      probe: () => {
        inFlight++;
        max = Math.max(max, inFlight);
        return new Promise<string | null>((r) => setTimeout(() => { inFlight--; r(null); }, 1));
      },
    });
    expect(found).toEqual([]);
    expect(max).toBeLessThanOrEqual(5);
    expect(max).toBe(5);
  });
  it('defaults to 24 concurrent probes', async () => {
    let inFlight = 0;
    let max = 0;
    await discover({
      subnets: ['10.0.2'],
      probe: () => {
        inFlight++;
        max = Math.max(max, inFlight);
        return new Promise<string | null>((r) => setTimeout(() => { inFlight--; r(null); }, 1));
      },
    });
    expect(max).toBe(24);
  });
  it('stops launching and aborts in-flight on cancel', async () => {
    let cancelled = false;
    let launched = 0;
    let aborted = 0;
    const found = await discover({
      subnets: ['10.0.3'],
      concurrency: 4,
      isCancelled: () => cancelled,
      probe: (_url, _t, register) => {
        launched++;
        const n = launched;
        return new Promise<string | null>((resolve) => {
          if (register) register(() => { aborted++; resolve(null); });
          if (n === 4) setTimeout(() => { cancelled = true; }, 5);
        });
      },
    });
    expect(found).toEqual([]);
    expect(launched).toBe(4);
    expect(aborted).toBe(4);
  });
  it('returns hits found before cancel', async () => {
    let cancelled = false;
    const found = await discover({
      subnets: ['10.0.4'],
      concurrency: 2,
      isCancelled: () => cancelled,
      probe: (url) => {
        if (url.indexOf('.1:8090') > 0) return Promise.resolve('V1');
        if (url.indexOf('.1:5665') > 0) { setTimeout(() => { cancelled = true; }, 5); }
        return new Promise<string | null>(() => {});
      },
    });
    expect(found).toEqual([{ url: 'http://10.0.4.1:8090', version: 'V1' }]);
  });
});

describe('getLocalIp', () => {
  const w = window as unknown as { Capacitor?: unknown; PalmServiceBridge?: unknown };
  afterEach(() => { delete w.Capacitor; delete w.PalmServiceBridge; });

  it('webOS: luna connectionmanager getStatus', async () => {
    const uris: string[] = [];
    w.PalmServiceBridge = function (this: any) {
      this.call = (uri: string) => {
        uris.push(uri);
        setTimeout(() => this.onservicecallback(JSON.stringify({ returnValue: true, wifi: { ipAddress: '192.168.7.30' } })), 0);
      };
    };
    expect(await getLocalIp()).toBe('192.168.7.30');
    expect(uris).toEqual(['luna://com.webos.service.connectionmanager/getStatus']);
  });

  it('Android TV: the native plugin localIpv4, never luna', async () => {
    let lunaCalls = 0;
    w.PalmServiceBridge = function (this: any) { this.call = () => { lunaCalls++; }; };
    w.Capacitor = {
      getPlatform: () => 'android',
      Plugins: {},
      nativePromise: (plugin: string, method: string) =>
        plugin === 'OmpNative' && method === 'localIpv4' ? Promise.resolve({ ip: '10.1.2.3' }) : Promise.reject({ message: 'x' }),
      addListener: () => ({ remove: () => undefined }),
    };
    expect(await getLocalIp()).toBe('10.1.2.3');
    expect(lunaCalls).toBe(0);
  });
});

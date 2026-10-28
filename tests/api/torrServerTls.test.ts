import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { TorrServerClient, setTorrServerTransport } from '../../src/api/torrserver';
import { transportFetch, transportError, type HttpTransport, type TransportRequest } from '../../src/api/http';
import {
  askTrust,
  certQuestionText,
  createTlsTransport,
  forgetRemovedServers,
  pinKey,
  formatFingerprint,
  resetTrustAnswers,
  setTrustUi,
  type CertQuestion,
  type NativeTls,
} from '../../src/api/torrServerTls';
import { mockFetch } from '../helpers/fetchMock';
import { servers, addServer, removeServer, updateServer } from '../../src/store/servers';

const FP = 'ab'.repeat(32);
const b64 = (s: string) => btoa(s);

function fakeNative(over: Partial<NativeTls> = {}): NativeTls & { trusted: string[] } {
  const trusted: string[] = [];
  return {
    trusted,
    http: vi.fn(() => Promise.resolve({ status: 200, base64: b64('"ok"') })),
    inspect: vi.fn(() => Promise.resolve({ state: 'untrusted', hostPort: 'ts.lan:8091', fingerprint: FP, subject: 'CN=TorrServer', notAfter: 0 })),
    trust: vi.fn((hp: string, fp: string) => {
      trusted.push(hp + ' ' + fp);
      return Promise.resolve();
    }),
    ...over,
  };
}

beforeEach(() => resetTrustAnswers());
afterEach(() => {
  setTrustUi(null);
  setTorrServerTransport(null);
  vi.unstubAllGlobals();
});

describe('askTrust', () => {
  it('asks once for concurrent requests and stores the pin on yes', async () => {
    const n = fakeNative();
    const ui = vi.fn((q: CertQuestion) => Promise.resolve(q.kind === 'untrusted'));
    setTrustUi(ui);
    const [a, b] = await Promise.all([askTrust(n, 'https://ts.lan:8091/echo'), askTrust(n, 'https://ts.lan:8091/torrents')]);
    expect(a && b).toBe(true);
    expect(ui).toHaveBeenCalledTimes(1);
    expect(n.trusted).toEqual(['ts.lan:8091 ' + FP]);
  });

  it('two servers ask one after the other: the second question does not cancel the first', async () => {
    const FP2 = 'cd'.repeat(32);
    const n = fakeNative({
      inspect: vi.fn((u: string) => Promise.resolve(u.indexOf('b.lan') >= 0
        ? { state: 'untrusted', hostPort: 'b.lan:8091', fingerprint: FP2 }
        : { state: 'untrusted', hostPort: 'a.lan:8091', fingerprint: FP })),
    });
    let open = 0;
    let most = 0;
    setTrustUi(() => {
      open++;
      most = Math.max(most, open);
      return new Promise((r) => setTimeout(() => {
        open--;
        r(true);
      }, 5));
    });
    const [a, b] = await Promise.all([askTrust(n, 'https://a.lan:8091/echo'), askTrust(n, 'https://b.lan:8091/echo')]);
    expect([a, b]).toEqual([true, true]);
    expect(most).toBe(1);
    expect(n.trusted).toEqual(['a.lan:8091 ' + FP, 'b.lan:8091 ' + FP2]);
  });

  it('remembers a no for that fingerprint and does not trust', async () => {
    const n = fakeNative();
    const ui = vi.fn(() => Promise.resolve(false));
    setTrustUi(ui);
    expect(await askTrust(n, 'https://ts.lan:8091/echo')).toBe(false);
    expect(await askTrust(n, 'https://ts.lan:8091/echo')).toBe(false);
    expect(ui).toHaveBeenCalledTimes(1);
    expect(n.trusted).toEqual([]);
  });

  it('never trusts without a dialog or with a bad fingerprint', async () => {
    const n = fakeNative();
    expect(await askTrust(n, 'https://ts.lan:8091/echo')).toBe(false);
    setTrustUi(() => Promise.resolve(true));
    const bad = fakeNative({ inspect: () => Promise.resolve({ state: 'untrusted', hostPort: 'ts.lan:8091', fingerprint: 'zz' }) });
    expect(await askTrust(bad, 'https://ts.lan:8091/echo')).toBe(false);
    expect(bad.trusted).toEqual([]);
  });

  it('shows the changed certificate as a warning', async () => {
    const n = fakeNative({ inspect: () => Promise.resolve({ state: 'changed', hostPort: 'ts.lan:8091', fingerprint: FP }) });
    let kind = '';
    setTrustUi((q) => {
      kind = q.kind;
      return Promise.resolve(true);
    });
    expect(await askTrust(n, 'https://ts.lan:8091/echo')).toBe(true);
    expect(kind).toBe('changed');
  });
});

describe('createTlsTransport', () => {
  const req = { method: 'GET' as const, headers: {}, timeoutMs: 5000 };

  it('sends again after the user trusts the certificate', async () => {
    let calls = 0;
    const n = fakeNative({
      http: vi.fn(() => (++calls === 1 ? Promise.reject({ code: 'tls-untrusted' }) : Promise.resolve({ status: 200, base64: b64('x') }))),
    });
    setTrustUi(() => Promise.resolve(true));
    const r = await createTlsTransport(n).send('https://ts.lan:8091/echo', req);
    expect(r).toEqual({ status: 200, base64: b64('x') });
    expect(calls).toBe(2);
  });

  it('keeps the refusal when the user says no, and other failures as they are', async () => {
    const n = fakeNative({ http: vi.fn(() => Promise.reject({ code: 'tls-changed' })) });
    setTrustUi(() => Promise.resolve(false));
    await expect(createTlsTransport(n).send('https://ts.lan:8091/echo', req)).rejects.toEqual({ code: 'tls-changed' });
    const t = fakeNative({ http: vi.fn(() => Promise.reject({ code: 'timeout' })) });
    await expect(createTlsTransport(t).send('https://ts.lan:8091/echo', req)).rejects.toEqual({ code: 'timeout' });
    expect(t.inspect).not.toHaveBeenCalled();
  });
});

describe('transport in http', () => {
  it('moves Content-Type out of the headers and decodes UTF-8', async () => {
    const send = vi.fn((_u: string, _r: TransportRequest) => Promise.resolve({ status: 200, base64: btoa(unescape(encodeURIComponent('Привет'))) }));
    const r = await transportFetch({ send }, 'https://h/x', { method: 'POST', headers: { 'Content-Type': 'application/json', A: '1' }, body: '{}', timeoutMs: 1 });
    expect(await r.text()).toBe('Привет');
    expect(send.mock.calls[0][1]).toMatchObject({ headers: { A: '1' }, contentType: 'application/json', body: '{}' });
  });

  it('maps failures to ApiErrors and keeps the certificate code', () => {
    expect(transportError({ code: 'timeout' }).kind).toBe('timeout');
    const e = transportError({ code: 'tls-untrusted' });
    expect(e.kind).toBe('network');
    expect(e.tls).toBe('tls-untrusted');
    expect(transportError(new Error('x')).tls).toBeUndefined();
  });
});

describe('TorrServerClient with a transport', () => {
  it('sends only its own https URLs through it', async () => {
    const send = vi.fn((_u: string, _r: TransportRequest) => Promise.resolve({ status: 200, base64: btoa('"1.2"') }));
    const tr: HttpTransport = { send };
    setTorrServerTransport(tr);
    const fn = mockFetch(() => ({ body: 'plain' }));
    const s = new TorrServerClient({ url: 'https://ts.lan:8091', user: 'u', password: 'p' });
    await s.echo();
    expect(send.mock.calls[0][0]).toBe('https://ts.lan:8091/echo');
    expect(send.mock.calls[0][1].headers['Authorization']).toBe('Basic ' + btoa('u:p'));
    await s.fetchText('https://other.example/x');
    expect(fn).toHaveBeenCalledTimes(1);
    await new TorrServerClient({ url: '192.168.1.5:8090' }).fetchText('http://192.168.1.5:8090/x');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('certQuestionText', () => {
  it('shows the host, the name and the fingerprint in lines of eight bytes', () => {
    expect(formatFingerprint(FP).split('\n')).toEqual(Array(4).fill(Array(8).fill('AB').join(':')));
    const x = certQuestionText({ kind: 'untrusted', hostPort: 'ts.lan:8091', fingerprint: FP, subject: 'O=x, CN=TorrServer', notAfter: Date.UTC(2030, 0, 15, 12) });
    expect(x.title).toContain('ts.lan:8091');
    expect(x.body).toContain('TorrServer');
    expect(x.body).toContain('15.01.2030');
    expect(x.body).toContain('AB:AB');
  });
});

describe('forgetRemovedServers', () => {
  it('pinKey: host:port of an https URL, 443 by default', () => {
    expect(pinKey('https://TS.lan:8091/x')).toBe('ts.lan:8091');
    expect(pinKey('https://u:p@ts.lan')).toBe('ts.lan:443');
    expect(pinKey('https://[fe80::1]:8443')).toBe('fe80::1:8443');
    expect(pinKey('https://[::FFFF:192.168.1.5]:8443')).toBe('192.168.1.5:8443');
    expect(pinKey('https://[fe80::1%25wlan0]:8443')).toBe('fe80::1:8443');
    expect(pinKey('http://ts.lan:8091')).toBeNull();
  });

  it('a removed or re-addressed https server drops its certificate; one still saved keeps it', () => {
    localStorage.clear();
    servers.value = [];
    const forget = vi.fn(() => Promise.resolve());
    const stop = forgetRemovedServers({ ...fakeNative(), forget });
    const a = addServer({ url: 'https://ts.lan:8091' });
    const b = addServer({ url: 'https://other.lan:8443' });
    addServer({ url: 'https://other.lan:8443/ts' });
    addServer({ url: '192.168.1.5:8090' });
    removeServer(b.id);
    const c = addServer({ url: 'https://[::ffff:192.168.1.5]:8443' });
    addServer({ url: 'https://192.168.1.5:8443' });
    removeServer(c.id);
    expect(forget).not.toHaveBeenCalled();
    updateServer(a.id, { url: 'https://ts.lan:9443' });
    expect(forget).toHaveBeenCalledWith('ts.lan:8091');
    stop();
    servers.value = [];
    expect(forget).toHaveBeenCalledTimes(1);
  });
});

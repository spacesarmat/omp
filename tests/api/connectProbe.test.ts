import { describe, it, expect, afterEach } from 'vitest';
import { probeServer, retryOtherScheme, isProbeFailure, isTorrServerVersion, type ProbeFailure } from '../../src/api/connectProbe';
import { connectErrorText } from '../../src/api/connectError';
import { apiError } from '../../src/api/http';
import { nativeTlsProbe, setTlsProbe, certificateRefused, canDetectTls } from '../../src/api/tlsProbe';

afterEach(() => setTlsProbe(null));

const fail = (p: Promise<unknown>) => p.then(() => { throw new Error('resolved'); }, (f: ProbeFailure) => f);

describe('probeServer', () => {
  it('the first candidate that answers wins', async () => {
    const seen: string[] = [];
    const r = await probeServer(['https://h:8443', 'http://h:8443'], (u) => { seen.push(u); return Promise.resolve('MatriX.145'); });
    expect(r).toEqual({ url: 'https://h:8443', version: 'MatriX.145' });
    expect(seen).toEqual(['https://h:8443']);
  });

  it('no answer, a wrong answer or the 400 of a TLS port: the next scheme is tried and saved', async () => {
    for (const e of [apiError('network', 'x'), apiError('parse', 'x'), apiError('http', 'HTTP 400', 400), apiError('http', 'HTTP 497', 497)]) {
      const seen: string[] = [];
      const r = await probeServer(['http://h:5665', 'https://h:5665'], (u) => {
        seen.push(u);
        return u.indexOf('http:') === 0 ? Promise.reject(e) : Promise.resolve('v');
      });
      expect(r.url).toBe('https://h:5665');
      expect(seen).toEqual(['http://h:5665', 'https://h:5665']);
    }
  });

  it('a web page on the first scheme is not TorrServer: the other one is tried', async () => {
    const r = await probeServer(['http://h', 'https://h'], (u) => Promise.resolve(u.indexOf('http:') === 0 ? '<!doctype html><html>' : ' MatriX.136\n'));
    expect(r).toEqual({ url: 'https://h', version: 'MatriX.136' });
    const f = await fail(probeServer(['http://h:8090'], () => Promise.resolve('<html>router</html>')));
    expect((f.error as { kind: string }).kind).toBe('parse');
    expect(isTorrServerVersion('1.2.133')).toBe(true);
    expect(isTorrServerVersion('')).toBe(false);
    expect(isTorrServerVersion('{"a":1}')).toBe(false);
  });

  it('a timeout or a 401 is not retried: the first error is the answer', async () => {
    for (const e of [apiError('timeout', 'Timeout'), apiError('http', 'HTTP 401', 401)]) {
      const seen: string[] = [];
      const f = await fail(probeServer(['http://h:5665', 'https://h:5665'], (u) => { seen.push(u); return Promise.reject(e); }));
      expect(seen).toEqual(['http://h:5665']);
      expect(isProbeFailure(f)).toBe(true);
      expect(f).toEqual({ url: 'http://h:5665', error: e, tls: false });
    }
  });

  it('both fail: the first one is shown; without a TLS probe no certificate is claimed', async () => {
    const f = await fail(probeServer(['https://h:8443', 'http://h:8443'], () => Promise.reject(apiError('network', 'x'))));
    expect(f.url).toBe('https://h:8443');
    expect(f.tls).toBe(false);
  });

  it('the platform probe says the certificate was refused: that https failure is shown as tls', async () => {
    const asked: string[] = [];
    setTlsProbe((u) => { asked.push(u); return Promise.resolve(true); });
    const f = await fail(probeServer(['http://h:5665', 'https://h:5665'], () => Promise.reject(apiError('network', 'x'))));
    expect(asked).toEqual(['https://h:5665']);
    expect(f).toMatchObject({ url: 'https://h:5665', tls: true });
  });

  it('the probe says no: the first failure stays', async () => {
    setTlsProbe(() => Promise.resolve(false));
    const f = await fail(probeServer(['http://h:5665', 'https://h:5665'], () => Promise.reject(apiError('network', 'x'))));
    expect(f).toMatchObject({ url: 'http://h:5665', tls: false });
  });

  it('retryOtherScheme', () => {
    expect(retryOtherScheme(apiError('network', 'x'))).toBe(true);
    expect(retryOtherScheme(apiError('http', 'HTTP 404', 404))).toBe(false);
    expect(retryOtherScheme(new Error('x'))).toBe(false);
  });
});

describe('tlsProbe', () => {
  it('the native probe: GET /echo without credentials; code tls is a refused certificate', async () => {
    const reqs: unknown[] = [];
    const p = nativeTlsProbe((req) => { reqs.push(req); return Promise.reject(Object.assign(new Error('cert'), { code: 'tls' })); });
    expect(await p('https://u:p@h:8443/ts/')).toBe(true);
    expect(reqs).toEqual([{ url: 'https://h:8443/ts/echo', method: 'GET', timeoutMs: 8000 }]);
    expect(await nativeTlsProbe(() => Promise.reject(new Error('no answer')))('https://h')).toBe(false);
    expect(await nativeTlsProbe(() => Promise.resolve({ status: 401 }))('https://h')).toBe(false);
  });

  it('http and no probe are never a certificate problem', async () => {
    expect(canDetectTls()).toBe(false);
    expect(await certificateRefused('https://h')).toBe(false);
    setTlsProbe(() => Promise.resolve(true));
    expect(canDetectTls()).toBe(true);
    expect(await certificateRefused('http://h')).toBe(false);
    expect(await certificateRefused('https://h')).toBe(true);
  });
});

describe('connectErrorText', () => {
  const net = apiError('network', 'x');
  it('keeps https://, drops http:// and never shows user:password@', () => {
    expect(connectErrorText('http://10.0.0.5:8090', net)).toBe('Не удалось подключиться к 10.0.0.5:8090 - проверьте адрес и порт');
    setTlsProbe(() => Promise.resolve(false));
    expect(connectErrorText('https://u:p@ts.example.com:8443/ts/', net)).toBe('Не удалось подключиться к https://ts.example.com:8443/ts - проверьте адрес и порт');
    expect(connectErrorText('http://u:p@h:8090', apiError('http', 'HTTP 401', 401))).toContain('к h:8090:');
  });

  it('a refused certificate is named', () => {
    expect(connectErrorText('https://ts.example.com:8443', net, true)).toBe(
      "Сертификат сервера https://ts.example.com:8443 не принят - нужен доверенный сертификат (например, Let's Encrypt через обратный прокси)",
    );
  });

  it('https without an answer where certificates cannot be told (LG): the line about them', () => {
    expect(connectErrorText('https://ts.example.com:8443', net)).toContain('Самоподписанный сертификат здесь не принимается');
    expect(connectErrorText('https://ts.example.com:8443', apiError('timeout', 'Timeout'))).not.toContain('сертификат');
  });
});

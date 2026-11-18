import { describe, expect, it, afterAll } from 'vitest';
import http from 'node:http';
import { isPublicSiteUrl } from '../src/monitorChecks.mjs';
import { monitorGet } from '../src/monitorHttp.mjs';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok');
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('monitor site SSRF guard', () => {
  it('accepts public http(s) tracker hosts', () => {
    for (const u of ['https://rutracker.org/forum/', 'http://example.com/', 'https://sub.example.co.uk/x', 'https://8.8.8.8/']) {
      expect(isPublicSiteUrl(u)).toBe(true);
    }
  });

  it('rejects loopback, private, link-local and CGN addresses', () => {
    for (const u of [
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://192.168.1.211/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://[::ffff:192.168.1.1]/',
    ]) {
      expect(isPublicSiteUrl(u)).toBe(false);
    }
  });

  it('rejects internal names, single labels and non-http schemes', () => {
    for (const u of [
      'http://localhost/',
      'http://omp.local/',
      'http://nas.internal/',
      'http://printer.lan/',
      'http://intranet/',
      'file:///etc/passwd',
      'gopher://example.com/',
      'ftp://example.com/',
      'not a url',
      '',
    ]) {
      expect(isPublicSiteUrl(u)).toBe(false);
    }
  });

  it('still accepts public IPv6 and bracketed public hosts', () => {
    expect(isPublicSiteUrl('https://[2001:4860:4860::8888]/')).toBe(true);
  });

  it('rejects a trailing-dot internal name', () => {
    expect(isPublicSiteUrl('http://localhost./')).toBe(false);
    expect(isPublicSiteUrl('http://nas.local./')).toBe(false);
  });
});

describe('monitorGet publicOnly resolve+pin', () => {
  it('refuses a loopback IP literal without connecting', async () => {
    const r = await monitorGet(`http://127.0.0.1:${port}/`, { publicOnly: true, timeoutMs: 2000 });
    expect(r).toMatchObject({ ok: false, error: 'private_address' });
  });

  it('refuses a name that resolves to a private address (DNS rebinding)', async () => {
    const r = await monitorGet(`http://localhost:${port}/`, { publicOnly: true, timeoutMs: 2000 });
    expect(r).toMatchObject({ ok: false, error: 'private_address' });
  });

  it('without publicOnly the same local server is reachable (tests/AIA keep working)', async () => {
    const r = await monitorGet(`http://127.0.0.1:${port}/`, { timeoutMs: 2000 });
    expect(r).toMatchObject({ ok: true, status: 200 });
  });
});
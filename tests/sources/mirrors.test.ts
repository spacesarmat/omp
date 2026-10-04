import { describe, it, expect, beforeEach } from 'vitest';
import { createSiteHosts, resetMirrors } from '../../src/sources/mirrors';
import { fakeSite, page, CLOUDFLARE } from './fakeSite';
import type { HttpCall } from './fakeSite';

beforeEach(() => resetMirrors());

describe('site mirrors', () => {
  it('a Cloudflare 52x origin error moves on; a 4xx does not', async () => {
    const hosts = createSiteHosts('t1', ['a.example', 'b.example']);
    const site = fakeSite((c: HttpCall) => page('x', c.url, c.url.indexOf('a.example') >= 0 ? 522 : 200));
    const res = await hosts.get(site.ctx, 'x.php');
    expect(res.status).toBe(200);
    expect(hosts.host()).toBe('b.example');
    resetMirrors();
    const four = fakeSite((c: HttpCall) => page('x', c.url, 404));
    expect((await hosts.get(four.ctx, 'x.php')).status).toBe(404);
    expect(four.calls).toHaveLength(1);
    expect(hosts.host()).toBe('a.example');
  });

  it('the last mirror\'s 52x is returned as it is; a Cloudflare check rejects without switching', async () => {
    const hosts = createSiteHosts('t2', ['a.example', 'b.example']);
    const site = fakeSite((c: HttpCall) => page('x', c.url, 521));
    expect((await hosts.get(site.ctx, 'p')).status).toBe(521);
    const cf = fakeSite(() => {
      const e = new Error('cf') as Error & { code?: string };
      e.code = 'cloudflare-interactive';
      throw e;
    });
    await expect(hosts.get(cf.ctx, 'p')).rejects.toThrow('cf');
    expect(cf.calls).toHaveLength(1);
    expect(CLOUDFLARE).toContain('Just a moment');
  });

  it('paths, subdomains and the remembered mirror (sanitized storage)', () => {
    const hosts = createSiteHosts('t3', ['a.example', 'b.example']);
    expect(hosts.path('https://b.example/details.php?id=1#x')).toBe('details.php?id=1');
    expect(hosts.path('https://dl.a.example/download.php?id=2')).toBe('download.php?id=2');
    expect(hosts.path('https://evil.example/a')).toBeNull();
    expect(hosts.onSite('http://www.b.example/')).toBe(true);
    hosts.adopt('https://b.example/x');
    expect(hosts.base()).toBe('https://b.example/');
    localStorage.setItem('tsp.sourceMirrors', JSON.stringify({ t3: 'evil.example' }));
    expect(hosts.host()).toBe('a.example');
    localStorage.setItem('tsp.sourceMirrors', '{"t3": 5}');
    expect(hosts.host()).toBe('a.example');
  });
});

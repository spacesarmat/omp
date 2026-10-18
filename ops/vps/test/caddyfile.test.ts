import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const text = readFileSync('ops/vps/Caddyfile', 'utf8');
const snippet = text.slice(text.indexOf('(security_headers)'), text.indexOf('# Project landing page'));

describe('Caddyfile security headers', () => {
  it('sets the exact HSTS policy once, with no preload, and deletes Server on its own', () => {
    const hsts = text.match(/Strict-Transport-Security[^\n]*/g) || [];
    expect(hsts).toEqual(['Strict-Transport-Security "max-age=15552000; includeSubDomains"']);
    expect(text.toLowerCase()).not.toContain('preload');
    expect(snippet).toContain('X-Content-Type-Options nosniff');
    expect(snippet).toContain('X-Frame-Options DENY');
    expect(snippet).toContain('Referrer-Policy strict-origin-when-cross-origin');
    expect(snippet).toMatch(/^\s*header -Server$/m);
    expect(snippet).not.toMatch(/header\s*\{[^}]*-Server/s);
  });

  it('imports the snippet on every site, including Caddy error responses', () => {
    for (const host of [
      'omp-player.online',
      'www.omp-player.online',
      'billing.omp-player.online',
      'jackett.omp-player.online',
      'jacred.omp-player.online',
    ]) {
      expect(text).toContain(host);
    }
    expect(text.match(/import security_headers/g)).toHaveLength(8);
    expect(text.match(/handle_errors \{/g)).toHaveLength(4);
  });

  it('rewrites /en and /en/ to the English page before the Russian fallback', () => {
    const landing = text.slice(text.indexOf('omp-player.online, www'), text.indexOf('billing.omp-player.online'));
    expect(landing).toContain('@en path /en /en/');
    expect(landing).toContain('rewrite @en /en/index.html');
    expect(landing.indexOf('rewrite @en')).toBeLessThan(landing.indexOf('try_files {path} /index.html'));
  });

  it('pins TLS 1.2+ on every site and does not name a certificate', () => {
    const tls = text.slice(text.indexOf('(tls_protocols)'), text.indexOf('(security_headers)'));
    const block = tls.slice(tls.indexOf('tls {'), tls.indexOf('}') + 1);
    expect(block.replace(/\s+/g, ' ').trim()).toBe('tls { protocols tls1.2 tls1.3 }');
    expect(text.match(/import tls_protocols/g)).toHaveLength(4);
  });
});

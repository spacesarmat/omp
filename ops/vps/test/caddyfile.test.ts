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
});

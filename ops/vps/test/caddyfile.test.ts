import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const text = readFileSync('ops/vps/Caddyfile', 'utf8');
const snippet = text.slice(text.indexOf('(security_headers_common)'), text.indexOf('# Project landing page'));
const common = snippet.slice(0, snippet.indexOf('(security_headers)'));
const deny = snippet.slice(snippet.indexOf('(security_headers)'));

describe('Caddyfile security headers', () => {
  it('sets the exact HSTS policy once, with no preload, and deletes Server on its own', () => {
    const hsts = text.match(/Strict-Transport-Security[^\n]*/g) || [];
    expect(hsts).toEqual(['Strict-Transport-Security "max-age=15552000; includeSubDomains"']);
    expect(text.toLowerCase()).not.toContain('preload');
    expect(snippet).toContain('X-Content-Type-Options nosniff');
    expect(common).not.toContain('X-Frame-Options');
    expect(deny).toContain('import security_headers_common');
    expect(deny).toMatch(/^\s*header X-Frame-Options DENY$/m);
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
    // The landing (2 imports) takes the common headers only; the 3 other sites
    // keep X-Frame-Options DENY on responses and errors.
    expect(text.match(/import security_headers_common$/gm)).toHaveLength(3);
    // 6 on billing/Jackett/JacRed, 1 on the www redirect.
    expect(text.match(/import security_headers$/gm)).toHaveLength(7);
    const landing = text.slice(text.indexOf('\nomp-player.online {'), text.indexOf('www.omp-player.online {'));
    expect(landing.match(/import security_headers_common$/gm)).toHaveLength(2);
    expect(landing).not.toMatch(/import security_headers$/m);
    const rest = text.slice(text.indexOf('billing.omp-player.online {'));
    expect(rest.match(/import security_headers$/gm)).toHaveLength(6);
    expect(rest).not.toContain('security_headers_common');
    expect(text.match(/handle_errors \{/g)).toHaveLength(4);
  });

  it('rewrites /en and /en/ to the English page before file_server', () => {
    const landing = text.slice(text.indexOf('\nomp-player.online {'), text.indexOf('www.omp-player.online {'));
    expect(landing).toContain('@en path /en /en/');
    expect(landing).toContain('rewrite @en /en/index.html');
    expect(landing.indexOf('rewrite @en')).toBeLessThan(landing.indexOf('file_server'));
  });

  it('pins TLS 1.2+ on every site and does not name a certificate', () => {
    const tls = text.slice(text.indexOf('(tls_protocols)'), text.indexOf('(security_headers)'));
    const block = tls.slice(tls.indexOf('tls {'), tls.indexOf('}') + 1);
    expect(block.replace(/\s+/g, ' ').trim()).toBe('tls { protocols tls1.2 tls1.3 }');
    expect(text.match(/import tls_protocols/g)).toHaveLength(5);
  });
});

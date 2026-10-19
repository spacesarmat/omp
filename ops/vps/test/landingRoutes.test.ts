import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = [
  { file: 'ops/vps/Caddyfile', apex: 'omp-player.online {', www: 'www.omp-player.online {' },
  { file: 'ops/vps/Caddyfile.nuc', apex: 'http://omp-player.online {', www: 'http://www.omp-player.online {' },
];

function block(text: string, head: string) {
  const start = text.indexOf('\n' + head);
  expect(start, head).toBeGreaterThan(-1);
  // Site blocks end at the first closing brace in column 0.
  return text.slice(start + 1, text.indexOf('\n}\n', start) + 2);
}

describe.each(FILES)('$file landing routes', ({ file, apex, www }) => {
  const text = readFileSync(file, 'utf8');
  const site = block(text, apex);
  const redirect = block(text, www);

  it('serves only the apex; www is its own block', () => {
    expect(text).not.toMatch(/omp-player\.online,\s*(http:\/\/)?www\.omp-player\.online/);
    expect(site).toContain('root * /srv/site');
  });

  it('sends www to the apex with a 301 that keeps path and query', () => {
    expect(redirect).toMatch(/^\s*redir https:\/\/omp-player\.online\{uri\} permanent$/m);
    expect(redirect).not.toContain('file_server');
    expect(redirect).toMatch(/^\s*import security_headers$/m);
  });

  it('has no SPA fallback, so unknown paths are a real 404 with site/404.html', () => {
    expect(site).not.toContain('try_files');
    const errors = site.slice(site.indexOf('handle_errors {'));
    expect(errors).toContain('@notfound expression {err.status_code} == 404');
    expect(errors).toMatch(/handle @notfound \{\s*rewrite \* \/404\.html\s*file_server\s*\}/);
    // The 404 response carries the same headers as the pages.
    expect(errors).toMatch(/import security_headers_common$/m);
    expect(errors).toMatch(/import landing_csp$/m);
    expect(site.slice(0, site.indexOf('handle_errors {'))).toMatch(/import landing_csp$/m);
  });
});

describe('site/404.html', () => {
  const html = readFileSync('ops/vps/site/404.html', 'utf8');

  it('is a Russian page in the site style that links home and to /en/', () => {
    expect(html).toContain('<html lang="ru">');
    expect(html).toMatch(/<link rel="stylesheet" href="\/style\.css\?v=[\w]+" \/>/);
    expect(html).toContain('<title>Страница не найдена - OMP</title>');
    expect(html).toContain('<h1>Страница не найдена</h1>');
    expect(html).toContain('href="/en/"');
    expect(html).toMatch(/<a class="button primary" href="\/">/);
  });

  it('is not indexed and uses absolute asset paths (it is served at any depth)', () => {
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
    expect(html).not.toContain('rel="canonical"');
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      expect(m[1], m[1]).toMatch(/^(\/|https:\/\/)/);
    }
  });

  it('does not load app.js, whose language redirect would leave the 404', () => {
    expect(html).not.toContain('app.js');
  });

  it('shares the cache-busting version with the pages', () => {
    const v = (f: string) => readFileSync(f, 'utf8').match(/style\.css\?v=(\w+)/)![1];
    expect(v('ops/vps/site/404.html')).toBe(v('ops/vps/site/index.html'));
    expect(v('ops/vps/site/en/index.html')).toBe(v('ops/vps/site/index.html'));
  });
});

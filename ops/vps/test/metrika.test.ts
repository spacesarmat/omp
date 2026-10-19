import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const COUNTER = '113673968';
const PAGES = ['ops/vps/site/index.html', 'ops/vps/site/en/index.html', 'ops/vps/site/404.html'];
const CADDYFILES = ['ops/vps/Caddyfile', 'ops/vps/Caddyfile.nuc'];
const NOSCRIPT =
  '<noscript><div><img src="https://mc.yandex.ru/watch/113673968" style="position:absolute; left:-9999px;" alt="" /></div></noscript>\n<!-- /Yandex.Metrika counter -->';

const METRIKA_FRAME_HOSTS = [
  'metrika.yandex.ru',
  'analytics.yandex.by',
  'analytics.yandex.com',
  'analytics.yandex.com.tr',
  'analytics.yandex.kz',
  'analytics.yandex.ru',
  'metr.yandex.by',
  'metr.yandex.com',
  'metr.yandex.com.tr',
  'metr.yandex.kz',
  'metr.yandex.ru',
  'metrica.ya.ru',
  'metrica.yandex',
  'metrica.yandex.by',
  'metrica.yandex.com',
  'metrica.yandex.com.tr',
  'metrica.yandex.kz',
  'metrica.yandex.ru',
  'metrika.ya.ru',
  'metrika.yandex',
  'metrika.yandex.by',
  'metrika.yandex.com',
  'metrika.yandex.com.tr',
  'metrika.yandex.kz',
  'metrika.yandex.uz',
];

const read = (p: string) => readFileSync(p, 'utf8');

function inlineScripts(html: string) {
  // JSON-LD is a data block, not executed, so CSP script-src does not apply to it.
  return [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

function sha256(text: string) {
  return "'sha256-" + createHash('sha256').update(text, 'utf8').digest('base64') + "'";
}

function landingCsp(caddy: string) {
  // The landing CSP lives in the (landing_csp) snippet, imported by the apex
  // site and its handle_errors (the 404 page).
  const start = caddy.indexOf('(landing_csp) {');
  expect(start).toBeGreaterThan(-1);
  const block = caddy.slice(start, caddy.indexOf('\n}\n', start));
  const m = block.match(/Content-Security-Policy "([^"]+)"/);
  expect(m).toBeTruthy();
  return Object.fromEntries(
    m![1].split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  ) as Record<string, string[]>;
}

describe('Yandex.Metrika on the public site', () => {
  it('puts the counter in <head> and the noscript pixel first in <body> on every page', () => {
    for (const page of PAGES) {
      const html = read(page);
      const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
      expect(head.match(/<!-- Yandex\.Metrika counter -->/g)).toHaveLength(1);
      expect(head).toContain("'https://mc.yandex.ru/metrika/tag.js?id=113673968', 'ym');");
      expect(head).toContain(`ym(${COUNTER}, 'init', {ssr:true, webvisor:true, clickmap:true,`);
      expect(html.slice(html.indexOf('<body>') + '<body>'.length).trimStart().startsWith(NOSCRIPT)).toBe(true);
      expect(html.match(/mc\.yandex\.ru\/watch\//g)).toHaveLength(1);
    }
  });

  it('allows exactly that inline script, and Metrika hosts, in both Caddy CSPs', () => {
    const hashes = PAGES.map((p) => inlineScripts(read(p)).map(sha256));
    for (const h of hashes) expect(h).toHaveLength(1);
    expect(hashes[1]).toEqual(hashes[0]);
    const policies = CADDYFILES.map((f) => landingCsp(read(f)));
    expect(policies[1]).toEqual(policies[0]);
    const csp = policies[0];
    expect(csp['script-src']).toEqual(["'self'", hashes[0][0], 'https://mc.yandex.ru', 'https://mc.yandex.com', 'https://yastatic.net']);
    expect(csp['script-src']).not.toContain("'unsafe-inline'");
    for (const host of ['https://mc.yandex.ru', 'https://mc.yandex.com']) {
      expect(csp['connect-src']).toContain(host);
      expect(csp['img-src']).toContain(host);
      expect(csp['frame-src']).toContain(host);
      expect(csp['child-src']).toContain(host);
    }
    expect(csp['connect-src']).toContain('https://yastatic.net');
    expect(csp['frame-src']).toContain('blob:');
    expect(csp['default-src']).toEqual(["'self'"]);
    // Yandex's frame-ancestors list for the Metrika interface (click and link maps).
    expect(csp['frame-ancestors']).toEqual(["'self'", ...METRIKA_FRAME_HOSTS.map((h) => 'https://' + h)]);
  });

  it('stays off billing, Jackett and JacRed', () => {
    for (const f of CADDYFILES) {
      const caddy = read(f);
      const rest = caddy.slice(caddy.indexOf('billing.omp-player.online {'));
      expect(rest).not.toContain('mc.yandex');
    }
    for (const f of ['ops/billing/public/index.html', 'ops/billing/admin/index.html']) {
      expect(read(f)).not.toContain('mc.yandex');
    }
  });
});

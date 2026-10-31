import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = readFileSync('ops/vps/site/t/index.html', 'utf8');
const js = readFileSync('ops/vps/site/title-link.js', 'utf8');
const links = JSON.parse(readFileSync('ops/vps/site/.well-known/assetlinks.json', 'utf8'));
const gradle = readFileSync('android/app/build.gradle', 'utf8');

function page() {
  const sandbox: { ompTitlePage?: {
    parsePath: (p: string) => { kind: string; id: number; season: number | null } | null;
    intentUrl: (r: { kind: string; id: number; season: number | null }) => string;
    pageUrl: (r: { kind: string; id: number; season: number | null }) => string;
    fill: (doc: Document, path: string, lang: string) => void;
  } } = {};
  runInNewContext(js, sandbox);
  return sandbox.ompTitlePage!;
}

describe('title link page', () => {
  const api = page();

  it('parses the same paths the app shares and builds an intent link with no tracking', () => {
    expect(api.parsePath('/t/movie/550')).toEqual({ kind: 'movie', id: 550, season: null });
    expect(api.parsePath('/t/tv/1396/s/2')).toEqual({ kind: 'tv', id: 1396, season: 2 });
    expect(api.parsePath('/t/movie/550/s/1')).toBeNull();
    const url = api.pageUrl({ kind: 'tv', id: 9, season: 2 });
    expect(url).toBe('https://omp-player.online/t/tv/9/s/2');
    const intent = api.intentUrl({ kind: 'tv', id: 9, season: 2 });
    expect(intent).toContain('package=com.spacesarmat.omp');
    expect(intent).toContain('scheme=https');
    expect(intent).not.toMatch(/utm_|magnet:|xt=urn:btih/i);
    expect(intent).toContain(encodeURIComponent(url));
  });

  it('is a noindex page with download buttons and the shared script', () => {
    expect(html).toContain('noindex, follow');
    expect(html).toContain('id="share-download"');
    expect(html).toContain('https://github.com/spacesarmat/omp/releases/latest');
    expect(html).toContain('src="/title-link.js?v=20261031a"');
    expect(html).not.toContain('app.js');
    expect(html).not.toMatch(/magnet:|utm_/);
  });

  it('publishes assetlinks for the release package with the release and debug fingerprints', () => {
    const debugFp = gradle.match(/SHA-256: ([0-9A-F:]+)/)![1];
    // apksigner verify --print-certs on OMP-0.20.8-beta.1-arm64.apk (public release)
    const releaseFp = 'BD:F5:16:CA:37:09:67:8A:CF:03:6C:12:CB:09:54:6A:9E:B2:55:A0:51:0F:53:EF:1D:AD:29:1A:51:F3:06:8D';
    expect(links).toHaveLength(1);
    expect(links[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(links[0].target.package_name).toBe('com.spacesarmat.omp');
    expect(links[0].target.sha256_cert_fingerprints).toEqual([releaseFp, debugFp]);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { applyDesktopFeeds } from '../site/desktop-downloads';

const FEED = 'https://spacesarmat.github.io/omp/';

function response(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

function href(selector: string): string | null {
  return document.querySelector(selector)?.getAttribute('href') ?? null;
}

describe('desktop download feeds', () => {
  it('replaces fallback hrefs from the windows, macOS and linux feeds', async () => {
    document.body.innerHTML = `
      <a data-download="desktop-windows" href="https://example.test/old-setup.exe">setup</a>
      <a data-download="desktop-windows" data-asset="portable" href="https://example.test/old-portable.exe">portable</a>
      <a data-download="desktop-macos" data-asset="arm64" href="https://example.test/old-arm.dmg">arm</a>
      <a data-download="desktop-macos" data-asset="x64" href="https://example.test/old-intel.dmg">intel</a>
      <a data-download="desktop-linux" data-asset="appimage" href="https://example.test/old.appimage">app</a>
      <a data-download="desktop-linux" data-asset="deb" href="https://example.test/old.deb">deb</a>
    `;
    const feeds: Record<string, unknown> = {
      [FEED + 'update-windows.json']: {
        version: '0.31.0',
        url: 'https://github.com/spacesarmat/omp/releases/download/v0.31.0/OMP-0.31.0-setup.exe',
        assets: {
          nsis: { url: 'https://github.com/spacesarmat/omp/releases/download/v0.31.0/OMP-0.31.0-setup.exe' },
          portable: { url: 'https://github.com/spacesarmat/omp/releases/download/v0.31.0/OMP-0.31.0-portable.exe' },
        },
      },
      [FEED + 'update-macos.json']: {
        version: '0.31.0',
        url: 'https://github.com/spacesarmat/omp/releases/download/v0.31.0/OMP-0.31.0-macos-arm64.dmg',
        assets: {
          arm64: { url: 'https://github.com/spacesarmat/omp/releases/download/v0.31.0/OMP-0.31.0-macos-arm64.dmg' },
          x64: { url: 'https://github.com/spacesarmat/omp/releases/download/v0.31.0/OMP-0.31.0-macos-x64.dmg' },
        },
      },
      [FEED + 'update-linux.json']: {
        version: '0.31.0',
        url: 'https://github.com/spacesarmat/omp/releases/download/v0.31.0/OMP-0.31.0-linux-x64.AppImage',
        assets: {
          appimage: { url: 'https://github.com/spacesarmat/omp/releases/download/v0.31.0/OMP-0.31.0-linux-x64.AppImage' },
          deb: { url: 'https://github.com/spacesarmat/omp/releases/download/v0.31.0/OMP-0.31.0-linux-x64.deb' },
        },
      },
    };
    const fetchImpl = vi.fn((url: string) => Promise.resolve(response(feeds[url])));
    await applyDesktopFeeds(document, fetchImpl as unknown as typeof fetch);

    const next = 'https://github.com/spacesarmat/omp/releases/download/v0.31.0/';
    expect(href('[data-download="desktop-windows"]:not([data-asset])')).toBe(next + 'OMP-0.31.0-setup.exe');
    expect(href('[data-asset="portable"]')).toBe(next + 'OMP-0.31.0-portable.exe');
    expect(href('[data-asset="arm64"]')).toBe(next + 'OMP-0.31.0-macos-arm64.dmg');
    expect(href('[data-asset="x64"]')).toBe(next + 'OMP-0.31.0-macos-x64.dmg');
    expect(href('[data-asset="appimage"]')).toBe(next + 'OMP-0.31.0-linux-x64.AppImage');
    expect(href('[data-asset="deb"]')).toBe(next + 'OMP-0.31.0-linux-x64.deb');
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      FEED + 'update-windows.json',
      FEED + 'update-macos.json',
      FEED + 'update-linux.json',
    ]);
  });

  it('keeps the stable fallback when the feed version is a beta', async () => {
    document.body.innerHTML = '<a data-download="desktop-windows" href="https://github.com/spacesarmat/omp/releases/download/v0.30.0/OMP-0.30.0-setup.exe">setup</a>';
    const fetchImpl = vi.fn(() => Promise.resolve(response({
      version: '0.31.0-beta.1',
      url: 'https://github.com/spacesarmat/omp/releases/download/desktop-0.31.0-beta.1/OMP-0.31.0-beta.1-setup.exe',
    })));
    await applyDesktopFeeds(document, fetchImpl as unknown as typeof fetch);
    expect(href('[data-download="desktop-windows"]')).toBe('https://github.com/spacesarmat/omp/releases/download/v0.30.0/OMP-0.30.0-setup.exe');
  });

  it('keeps the fallback href when a feed url is not a release file', async () => {
    document.body.innerHTML = '<a data-download="desktop-windows" href="https://github.com/spacesarmat/omp/releases/download/v0.30.0/OMP-0.30.0-setup.exe">setup</a>';
    const fetchImpl = vi.fn(() => Promise.resolve(response({
      url: 'javascript:alert(1)',
      assets: { portable: { url: 'https://example.test/portable.exe' } },
    })));
    await applyDesktopFeeds(document, fetchImpl as unknown as typeof fetch);
    expect(href('[data-download="desktop-windows"]')).toBe('https://github.com/spacesarmat/omp/releases/download/v0.30.0/OMP-0.30.0-setup.exe');
  });

  it('keeps the fallback href when a feed cannot be loaded', async () => {
    document.body.innerHTML = '<a data-download="desktop-windows" href="https://example.test/old-setup.exe">setup</a>';
    const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')));
    await applyDesktopFeeds(document, fetchImpl as unknown as typeof fetch);
    expect(href('[data-download="desktop-windows"]')).toBe('https://example.test/old-setup.exe');
  });
});

describe('landing CSP allows the desktop feeds', () => {
  it('lets the site script connect to the GitHub Pages feeds', () => {
    for (const file of ['ops/vps/Caddyfile', 'ops/vps/Caddyfile.nuc']) {
      const text = readFileSync(file, 'utf8');
      const policy = text.slice(text.indexOf('Content-Security-Policy'), text.indexOf('base-uri'));
      expect(policy).toContain("connect-src 'self' https://spacesarmat.github.io");
    }
  });
});

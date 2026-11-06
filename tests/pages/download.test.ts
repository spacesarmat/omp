import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';
import { updateDownloads } from '../../ops/pages/download';

const KINDS = ['stable-android', 'stable-webos', 'beta-android', 'beta-webos'] as const;

function fixture(): void {
  document.body.innerHTML = KINDS.map((kind) => `
    <a data-download="${kind}" href="https://github.com/spacesarmat/omp/releases">fallback ${kind}</a>
    <a data-download="${kind}" data-abi="arm64" href="https://github.com/spacesarmat/omp/releases">arm64</a>
    <a data-download="${kind}" data-abi="armv7" href="https://github.com/spacesarmat/omp/releases">armv7</a>
  `).join('') + '<span data-version="stable">Stable fallback</span><span data-version="beta">Beta fallback</span>';
}

function response(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

function link(kind: string, abi?: string): HTMLAnchorElement {
  const suffix = abi ? `[data-abi="${abi}"]` : ':not([data-abi])';
  return document.querySelector(`[data-download="${kind}"]${suffix}`)!;
}

describe('download page feeds', () => {
  beforeEach(fixture);

  it('uses current stable and beta versions and direct download URLs', async () => {
    const feeds: Record<string, unknown> = {
      '/omp/update-android.json': {
        version: '1.0.0',
        ipkUrl: 'https://example.test/stable.apk',
        apks: {
          arm64: { url: 'https://example.test/stable-arm64.apk' },
          armv7: { url: 'https://example.test/stable-armv7.apk' },
        },
      },
      '/omp/update.json': { version: '1.0.0', ipkUrl: 'https://example.test/stable.ipk' },
      '/omp/update-android-beta.json': {
        version: '1.1.0-beta.2',
        ipkUrl: 'https://example.test/beta.apk',
        apks: {
          arm64: { url: 'https://example.test/beta-arm64.apk' },
          armv7: { url: 'https://example.test/beta-armv7.apk' },
        },
      },
      '/omp/update-beta.json': { version: '1.1.0-beta.2', ipkUrl: 'https://example.test/beta.ipk' },
    };
    const fetchImpl = vi.fn((url: string) => Promise.resolve(response(feeds[url])));
    await updateDownloads(document, fetchImpl as unknown as typeof fetch);

    expect(link('stable-android').href).toBe('https://example.test/stable.apk');
    expect(link('stable-android', 'arm64').href).toBe('https://example.test/stable-arm64.apk');
    expect(link('stable-android', 'armv7').href).toBe('https://example.test/stable-armv7.apk');
    expect(link('stable-webos').href).toBe('https://example.test/stable.ipk');
    expect(link('beta-android').href).toBe('https://example.test/beta.apk');
    expect(link('beta-android', 'arm64').href).toBe('https://example.test/beta-arm64.apk');
    expect(link('beta-android', 'armv7').href).toBe('https://example.test/beta-armv7.apk');
    expect(link('beta-webos').href).toBe('https://example.test/beta.ipk');
    expect(document.querySelector('[data-version="stable"]')!.textContent).toBe('1.0.0');
    expect(document.querySelector('[data-version="beta"]')!.textContent).toBe('1.1.0-beta.2');
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      '/omp/update-android.json',
      '/omp/update.json',
      '/omp/update-android-beta.json',
      '/omp/update-beta.json',
    ]);
  });

  it('keeps release-page fallbacks when feeds cannot be loaded', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')));
    await updateDownloads(document, fetchImpl as unknown as typeof fetch);

    for (const kind of KINDS) {
      expect(link(kind).href).toBe('https://github.com/spacesarmat/omp/releases');
      expect(link(kind, 'arm64').href).toBe('https://github.com/spacesarmat/omp/releases');
      expect(link(kind, 'armv7').href).toBe('https://github.com/spacesarmat/omp/releases');
    }
    expect(document.querySelector('[data-version="stable"]')!.textContent).toBe('Stable fallback');
    expect(document.querySelector('[data-version="beta"]')!.textContent).toBe('Beta fallback');
  });

  it('keeps ABI fallbacks when a feed has no per-ABI links', async () => {
    const feeds: Record<string, unknown> = {
      '/omp/update-android.json': { version: '1.0.0', ipkUrl: 'https://example.test/stable.apk' },
      '/omp/update.json': { version: '1.0.0', ipkUrl: 'https://example.test/stable.ipk' },
      '/omp/update-android-beta.json': { version: '1.1.0-beta.2', ipkUrl: 'https://example.test/beta.apk' },
      '/omp/update-beta.json': { version: '1.1.0-beta.2', ipkUrl: 'https://example.test/beta.ipk' },
    };
    const fetchImpl = vi.fn((url: string) => Promise.resolve(response(feeds[url])));
    await updateDownloads(document, fetchImpl as unknown as typeof fetch);

    expect(link('stable-android').href).toBe('https://example.test/stable.apk');
    expect(link('stable-android', 'arm64').href).toBe('https://github.com/spacesarmat/omp/releases');
    expect(link('beta-android', 'armv7').href).toBe('https://github.com/spacesarmat/omp/releases');
  });
});

describe('download page languages and fallbacks', () => {
  const pages = [
    { file: 'ops/pages/index.html', lang: 'ru', title: 'Скачать OMP', otherLang: 'en', otherPath: '/omp/en/', script: './download.js', guide: 'https://github.com/spacesarmat/omp#установка', mainSite: 'https://omp-player.online', logo: './assets/logo.svg' },
    { file: 'ops/pages/en/index.html', lang: 'en', title: 'Download OMP', otherLang: 'ru', otherPath: '/omp/', script: '../download.js', guide: 'https://github.com/spacesarmat/omp/blob/main/README.en.md#install', mainSite: 'https://omp-player.online/en/', logo: '../assets/logo.svg' },
  ];

  for (const page of pages) {
    it(`${page.lang} keeps language switching and all release fallbacks`, () => {
      const doc = new DOMParser().parseFromString(readFileSync(page.file, 'utf8'), 'text/html');
      expect(doc.documentElement.lang).toBe(page.lang);
      expect(doc.body.textContent).toContain(page.title);
      const switchLink = doc.querySelector(`a[hreflang="${page.otherLang}"]`)!;
      expect(switchLink.getAttribute('href')).toBe(page.otherPath);
      expect(doc.querySelector(`link[rel="alternate"][hreflang="${page.otherLang}"]`)!.getAttribute('href')).toBe(page.otherPath);
      expect(doc.querySelector(`a[hreflang="${page.lang}"]`)!.getAttribute('aria-current')).toBe('page');
      expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
      expect(doc.querySelector('meta[name="text-scale"]')!.getAttribute('content')).toBe('scale');
      expect(doc.querySelector('script[type="module"]')!.getAttribute('src')).toBe(page.script);
      const logo = doc.querySelector('img.brand-logo')!;
      expect(logo.getAttribute('src')).toBe(page.logo);
      expect(logo.getAttribute('width')).toBe('40');
      expect(logo.getAttribute('height')).toBe('40');
      expect(logo.getAttribute('alt')).toBe('');

      for (const kind of KINDS) {
        expect(doc.querySelector(`[data-download="${kind}"]:not([data-abi])`)).not.toBeNull();
      }
      for (const kind of ['stable-android', 'beta-android']) {
        expect(doc.querySelector(`[data-download="${kind}"][data-abi="arm64"]`)).not.toBeNull();
        expect(doc.querySelector(`[data-download="${kind}"][data-abi="armv7"]`)).not.toBeNull();
      }
      expect(doc.querySelector('[data-download="stable-android"]:not([data-abi])')!.getAttribute('href')).toBe('https://github.com/spacesarmat/omp/releases/latest');
      expect(doc.querySelector('[data-download="beta-android"]:not([data-abi])')!.getAttribute('href')).toBe('https://github.com/spacesarmat/omp/releases');
      expect(doc.querySelectorAll(`a[href="${page.mainSite}"]`)).toHaveLength(2);
      expect(doc.querySelector('a[href="https://github.com/spacesarmat/omp"]')).not.toBeNull();
      expect(doc.querySelector(`a[href="${page.guide}"]`)).not.toBeNull();
      expect(doc.querySelector('[data-version="stable"]')).not.toBeNull();
      expect(doc.querySelector('[data-version="beta"]')).not.toBeNull();

      const html = doc.documentElement.outerHTML;
      expect(html).not.toContain('fonts.googleapis.com');
      expect(html).not.toContain('mc.yandex.ru');
      expect(html).not.toContain('googletagmanager.com');
      for (const script of doc.querySelectorAll('script[src]')) {
        expect(script.getAttribute('src')).not.toMatch(/^https?:/);
      }
    });
  }
});

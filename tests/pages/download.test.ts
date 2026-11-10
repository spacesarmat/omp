import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore node builtins
import { readFileSync } from 'node:fs';
import { detectPlatform, formatReleaseDate, formatSize, highlightPlatform, updateDownloads } from '../../ops/pages/download';

const KINDS = ['stable-android', 'stable-webos', 'beta-android', 'beta-webos', 'beta-windows'] as const;

function fixture(): void {
  document.body.innerHTML = KINDS.map((kind) => `
    <a data-download="${kind}" href="https://github.com/spacesarmat/omp/releases">fallback ${kind}</a>
    <a data-download="${kind}" data-abi="arm64" href="https://github.com/spacesarmat/omp/releases">arm64</a>
    <a data-download="${kind}" data-abi="armv7" href="https://github.com/spacesarmat/omp/releases">armv7</a>
  `).join('') + '<span data-version="stable">Stable fallback</span><span data-version="beta">Beta fallback</span><span data-version="beta-windows">Windows fallback</span>';
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
      '/omp/update-windows.json': { version: '0.20.12-beta.2', url: 'https://example.test/beta-setup.exe' },
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
    expect(link('beta-windows').href).toBe('https://example.test/beta-setup.exe');
    expect(document.querySelector('[data-version="stable"]')!.textContent).toBe('1.0.0');
    expect(document.querySelector('[data-version="beta"]')!.textContent).toBe('1.1.0-beta.2');
    expect(document.querySelector('[data-version="beta-windows"]')!.textContent).toBe('0.20.12-beta.2');
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      '/omp/update-android.json',
      '/omp/update.json',
      '/omp/update-android-beta.json',
      '/omp/update-beta.json',
      '/omp/update-windows.json',
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
    expect(document.querySelector('[data-version="beta-windows"]')!.textContent).toBe('Windows fallback');
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

  it('fills every matching tile with size, sha256 and the release date', async () => {
    document.body.innerHTML = `
      <a data-download="stable-android" href="https://github.com/spacesarmat/omp/releases">phone</a>
      <a data-download="stable-android" href="https://github.com/spacesarmat/omp/releases">tv</a>
      <button type="button" data-sha-for="stable-android" hidden></button>
      <span data-size="stable-android" hidden></span>
      <span data-date="stable-android" hidden></span>
      <span data-version="stable"></span>
    `;
    document.documentElement.lang = 'en';
    const feeds: Record<string, unknown> = {
      '/omp/update-android.json': {
        version: '0.20.11',
        ipkUrl: 'https://example.test/stable.apk',
        ipkHash: 'a'.repeat(64),
        ipkSize: 2048,
        releaseUrl: 'https://github.com/spacesarmat/omp/releases/tag/v0.20.11',
      },
    };
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/omp/update-android.json') return Promise.resolve(response(feeds[url]));
      if (url.endsWith('/releases/tags/v0.20.11')) return Promise.resolve(response({ published_at: '2026-11-01T00:00:00Z' }));
      return Promise.resolve(response({}));
    });
    await updateDownloads(document, fetchImpl as unknown as typeof fetch);
    const links = document.querySelectorAll('[data-download="stable-android"]');
    expect(links).toHaveLength(2);
    for (const item of links) expect((item as HTMLAnchorElement).href).toBe('https://example.test/stable.apk');
    const hash = document.querySelector('[data-sha-for="stable-android"]')!;
    expect(hash.getAttribute('data-sha')).toBe('a'.repeat(64));
    expect(hash.textContent).toBe('sha256 ' + 'a'.repeat(12));
    expect((hash as HTMLElement).hidden).toBe(false);
    expect(document.querySelector('[data-size="stable-android"]')!.textContent).toBe('2.0 KB');
    expect(document.querySelector('[data-date="stable-android"]')!.textContent).toBe('1 Nov 2026');
    expect(formatSize(93182122)).toBe('88.9 MB');
    expect(formatReleaseDate('2026-11-01T00:00:00Z', 'ru')).not.toMatch(/[\u2012\u2013\u2014]/);
  });
});

describe('download page platform highlight', () => {
  it('marks the visitor platform and leaves the others alone', () => {
    document.body.innerHTML = `
      <article data-platform="android"><p class="you" hidden>you</p></article>
      <article data-platform="android-tv"><p class="you" hidden>you</p></article>
      <article data-platform="webos"><p class="you" hidden>you</p></article>
      <article data-platform="windows"><p class="you" hidden>you</p></article>
    `;
    expect(detectPlatform('Mozilla/5.0 (Web0S; Linux) AppleWebKit')).toBe('webos');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit')).toBe('android-tv');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit')).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(highlightPlatform(document, 'Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
    const yours = document.querySelector('[data-platform="android"]')!;
    expect(yours.classList.contains('is-yours')).toBe(true);
    expect((yours.querySelector('.you') as HTMLElement).hidden).toBe(false);
    expect(document.querySelector('[data-platform="windows"]')!.classList.contains('is-yours')).toBe(false);
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
      expect(doc.querySelector('[data-download="beta-windows"]:not([data-abi])')!.getAttribute('href')).toBe('https://github.com/spacesarmat/omp/releases/download/desktop-0.20.12-beta.2/OMP-0.20.12-beta.2-setup.exe');
      expect(doc.querySelectorAll(`a[href="${page.mainSite}"]`)).toHaveLength(2);
      expect(doc.querySelector('a[href="https://github.com/spacesarmat/omp"]')).not.toBeNull();
      expect(doc.querySelector(`a[href="${page.guide}"]`)).not.toBeNull();
      expect(doc.querySelector('[data-version="stable"]')).not.toBeNull();
      expect(doc.querySelector('[data-version="beta"]')).not.toBeNull();
      expect(doc.querySelector('[data-version="beta-windows"]')).not.toBeNull();

      const html = doc.documentElement.outerHTML;
      expect(html).not.toContain('fonts.googleapis.com');
      expect(html).not.toContain('mc.yandex.ru');
      expect(html).not.toContain('googletagmanager.com');
      for (const script of doc.querySelectorAll('script[src]')) {
        expect(script.getAttribute('src')).not.toMatch(/^https?:/);
      }
    });

    it(`${page.lang} keeps one tile column on a narrow screen and monospace versions`, () => {
      const doc = new DOMParser().parseFromString(readFileSync(page.file, 'utf8'), 'text/html');
      const style = document.createElement('style');
      style.textContent = doc.querySelector('style')!.textContent;
      document.head.append(style);
      try {
        const rules = Array.from(style.sheet!.cssRules).flatMap((rule) => (
          rule.type === CSSRule.MEDIA_RULE ? Array.from((rule as CSSMediaRule).cssRules) : [rule]
        ));
        const styleRule = (selector: string): CSSStyleRule[] => rules.filter((rule): rule is CSSStyleRule => (
          rule.type === CSSRule.STYLE_RULE && (rule as CSSStyleRule).selectorText === selector
        ));
        const tiles = styleRule('.tiles');
        expect(tiles).toHaveLength(2);
        for (const rule of tiles) expect(rule.style.display).toBe('grid');
        expect(tiles[1].style.gridTemplateColumns).toBe('1fr');
        const mono = styleRule('.mono')[0];
        expect(mono.style.fontFamily).toMatch(/monospace/);
        expect(mono.style.whiteSpace).toBe('normal');
        expect(mono.style.overflowWrap).toBe('anywhere');
        expect(doc.querySelectorAll('[data-platform]')).toHaveLength(4);
      } finally {
        style.remove();
      }
    });
  }
});

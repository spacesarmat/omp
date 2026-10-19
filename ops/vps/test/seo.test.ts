import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SITE = 'ops/vps/site';
const ORIGIN = 'https://omp-player.online';
const PAGES = [
  { file: `${SITE}/index.html`, url: `${ORIGIN}/`, lang: 'ru', locale: 'ru_RU' },
  { file: `${SITE}/en/index.html`, url: `${ORIGIN}/en/`, lang: 'en', locale: 'en_US' },
];
const CYRILLIC = /\p{Script=Cyrillic}/u;

const doc = (file: string) => new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'text/html');
const meta = (d: Document, sel: string) => d.querySelector(sel)?.getAttribute('content') ?? '';

/** Width and height from the first JPEG SOF marker. */
function jpegSize(buf: Buffer) {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

describe('landing SEO', () => {
  it('has a short keyword title and description, keywords, canonical and robots on both pages', () => {
    for (const p of PAGES) {
      const d = doc(p.file);
      expect(d.documentElement.lang).toBe(p.lang);
      expect(d.title).toMatch(/TorrServer/);
      expect(d.title).toMatch(/LG webOS/);
      expect(d.title.length).toBeLessThanOrEqual(65);
      const description = meta(d, 'meta[name="description"]');
      expect(description).toMatch(/TorrServer/);
      expect(description.length).toBeGreaterThanOrEqual(120);
      expect(description.length).toBeLessThanOrEqual(160);
      const keywords = meta(d, 'meta[name="keywords"]').split(',').map((k) => k.trim());
      expect(keywords.length).toBeGreaterThanOrEqual(8);
      expect(keywords.length).toBeLessThanOrEqual(20);
      expect(keywords).toContain('TorrServer');
      expect(d.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
      expect(d.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(p.url);
      expect(meta(d, 'meta[name="robots"]')).toMatch(/^index, follow/);
      expect(d.querySelectorAll('h1')).toHaveLength(1);
    }
    const en = doc(PAGES[1].file);
    for (const value of [en.title, meta(en, 'meta[name="keywords"]'), meta(en, 'meta[name="description"]')]) {
      expect(value).not.toMatch(CYRILLIC);
    }
  });

  it('shares an existing 1200x630 Open Graph image with matching OG and Twitter tags', () => {
    const size = jpegSize(readFileSync(`${SITE}/assets/og-image.jpg`));
    expect(size).toEqual({ width: 1200, height: 630 });
    for (const p of PAGES) {
      const d = doc(p.file);
      expect(meta(d, 'meta[property="og:url"]')).toBe(p.url);
      expect(meta(d, 'meta[property="og:locale"]')).toBe(p.locale);
      expect(meta(d, 'meta[property="og:title"]')).toBe(d.title);
      expect(meta(d, 'meta[property="og:description"]')).toBe(meta(d, 'meta[name="description"]'));
      expect(meta(d, 'meta[property="og:image"]')).toBe(`${ORIGIN}/assets/og-image.jpg`);
      expect(meta(d, 'meta[name="twitter:card"]')).toBe('summary_large_image');
      expect(meta(d, 'meta[name="twitter:image"]')).toBe(`${ORIGIN}/assets/og-image.jpg`);
    }
  });

  it('describes the app as a free SoftwareApplication in JSON-LD', () => {
    for (const p of PAGES) {
      const blocks = [...doc(p.file).querySelectorAll('script[type="application/ld+json"]')];
      expect(blocks).toHaveLength(1);
      const data = JSON.parse(blocks[0].textContent || '');
      expect(data['@type']).toBe('SoftwareApplication');
      expect(data.name).toBe('OMP');
      expect(data.url).toBe(p.url);
      expect(data.image).toBe(`${ORIGIN}/assets/og-image.jpg`);
      expect(data.operatingSystem).toContain('LG webOS 4.0+');
      expect(data.operatingSystem).toContain('Android TV');
      expect(data.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'RUB' });
      expect(data).not.toHaveProperty('aggregateRating');
    }
  });

  it('gives every image an alt and keeps the same FAQ on both pages', () => {
    const counts = PAGES.map((p) => {
      const d = doc(p.file);
      for (const img of d.querySelectorAll('img')) expect(img.hasAttribute('alt')).toBe(true);
      const summaries = [...d.querySelectorAll('#faq details summary h3')];
      for (const s of summaries) expect(s.closest('details')?.querySelector('p')?.textContent?.trim()).toBeTruthy();
      return summaries.length;
    });
    expect(counts[0]).toBeGreaterThanOrEqual(4);
    expect(counts[1]).toBe(counts[0]);
  });

  it('points robots.txt at a sitemap that lists both pages with hreflang', () => {
    const robots = readFileSync(`${SITE}/robots.txt`, 'utf8');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
    expect(robots).toMatch(new RegExp(`^Sitemap: ${ORIGIN}/sitemap.xml$`, 'm'));
    const sitemap = new DOMParser().parseFromString(readFileSync(`${SITE}/sitemap.xml`, 'utf8'), 'application/xml');
    expect(sitemap.querySelector('parsererror')).toBeNull();
    const locs = [...sitemap.getElementsByTagName('loc')].map((n) => n.textContent);
    expect(locs).toEqual(PAGES.map((p) => p.url));
    for (const url of sitemap.getElementsByTagName('url')) {
      const alts = [...url.getElementsByTagName('xhtml:link')].map((l) => `${l.getAttribute('hreflang')} ${l.getAttribute('href')}`);
      expect(alts).toEqual([`ru ${ORIGIN}/`, `en ${ORIGIN}/en/`, `x-default ${ORIGIN}/`]);
    }
  });
});

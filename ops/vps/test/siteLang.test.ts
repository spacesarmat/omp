import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ruHtml = readFileSync('ops/vps/site/index.html', 'utf8');
const enHtml = readFileSync('ops/vps/site/en/index.html', 'utf8');
const appJs = readFileSync('ops/vps/site/app.js', 'utf8');

const CYRILLIC = /\p{Script=Cyrillic}/u;
const LANGS = ['ru', 'en', 'uk', 'be', 'kk', 'ky', 'uz', 'tg', 'tk', 'hy', 'az', 'ka', 'ro'];
const langUrl = (l: string) => (l === 'ru' ? 'https://omp-player.online/' : `https://omp-player.online/${l}/`);
const ALTERNATES = [
  ...LANGS.map((l) => ({ hreflang: l, href: langUrl(l) })),
  { hreflang: 'x-default', href: 'https://omp-player.online/' },
];
const switcherFor = (page: string) =>
  LANGS.map((l) => ({ lang: l, text: l.toUpperCase(), href: l === 'ru' ? '/' : `/${l}/`, current: l === page ? 'page' : null }));

function parse(html: string) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function alternates(html: string) {
  const doc = parse(html);
  return [...doc.querySelectorAll('link[rel="alternate"]')].map((link) => ({
    hreflang: link.getAttribute('hreflang'),
    href: link.getAttribute('href'),
  }));
}

function switcher(html: string) {
  const doc = parse(html);
  return [...doc.querySelectorAll('.lang-switch [data-set-lang]')].map((link) => ({
    lang: link.getAttribute('data-set-lang'),
    text: link.textContent?.trim(),
    href: link.getAttribute('data-lang-href'),
    current: link.getAttribute('aria-current'),
  }));
}

function assetVersion(html: string, file: string) {
  const match = html.match(new RegExp(`${file.replace('/', '\\/')}\\?v=([^"']+)`));
  return match?.[1] ?? '';
}

/** Visible copy, alts and labels. The RU switcher label is the one allowed Cyrillic exception. */
function visibleCopy(html: string) {
  const doc = parse(html);
  const chunks: string[] = [doc.title];
  const description = doc.querySelector('meta[name="description"]');
  if (description) chunks.push(description.getAttribute('content') || '');
  doc.querySelectorAll('meta[property^="og:"]').forEach((meta) => {
    chunks.push(meta.getAttribute('content') || '');
  });
  const body = doc.body.cloneNode(true) as HTMLElement;
  body.querySelectorAll('script, style, [data-set-lang="ru"]').forEach((el) => el.remove());
  chunks.push(body.textContent || '');
  body.querySelectorAll('*').forEach((el) => {
    for (const name of ['alt', 'aria-label', 'title', 'placeholder', 'data-alt', 'data-label-pause', 'data-label-resume']) {
      const value = el.getAttribute(name);
      if (value) chunks.push(value);
    }
  });
  return chunks.join('\n');
}

type LangState = {
  choice: string | null;
  pathname: string;
  language: string;
  hash: string;
  search: string;
};

function loadDecide() {
  const start = appJs.indexOf('const SITE_LANGS');
  const end = appJs.indexOf('// end decideLangRedirect');
  const context: { decideLangRedirect?: (state: LangState) => string | null } = {};
  vm.runInNewContext(`${appJs.slice(start, end)}\nthis.decideLangRedirect = decideLangRedirect;`, context);
  if (!context.decideLangRedirect) throw new Error('decideLangRedirect missing');
  return context.decideLangRedirect;
}

const decide = loadDecide();

describe('public site languages', () => {
  it('serves Russian at / and English at /en/ with a RU | EN switcher', () => {
    expect(parse(ruHtml).documentElement.lang).toBe('ru');
    expect(parse(enHtml).documentElement.lang).toBe('en');
    expect(switcher(ruHtml)).toEqual(switcherFor('ru'));
    expect(switcher(enHtml)).toEqual(switcherFor('en'));
  });

  it('advertises ru, en and x-default on both pages', () => {
    expect(alternates(ruHtml)).toEqual(ALTERNATES);
    expect(alternates(enHtml)).toEqual(ALTERNATES);
  });

  it('keeps the English page free of Cyrillic outside the RU switcher label', () => {
    expect(visibleCopy(enHtml)).not.toMatch(CYRILLIC);
    expect(appJs).not.toMatch(CYRILLIC);
    expect(enHtml).toContain('>RU<');
  });

  it('loads CSS, JS and images from the site root with one cache-bust', () => {
    const css = assetVersion(ruHtml, '/style.css');
    const js = assetVersion(ruHtml, '/app.js');
    expect(css).toBeTruthy();
    expect(js).toBe(css);
    expect(assetVersion(enHtml, '/style.css')).toBe(css);
    expect(assetVersion(enHtml, '/app.js')).toBe(js);
    expect(enHtml).not.toMatch(/(?:href|src)="(?!\/|https?:|#)[^"]*"/);
    expect(appJs).toContain('function decideLangRedirect');
  });

  it('redirects a first visit to / once, and never after an explicit choice', () => {
    const home = { choice: null, pathname: '/', hash: '', search: '' };
    expect(decide({ ...home, language: 'en-US' })).toBe('/en/');
    expect(decide({ ...home, language: 'de', hash: '#how', search: '?from=nav' })).toBe('/en/?from=nav#how');
    expect(decide({ ...home, pathname: '/index.html', language: 'fr', hash: '#download' })).toBe('/en/#download');

    for (const language of ['ru', 'ru-RU']) {
      expect(decide({ ...home, language })).toBeNull();
    }
    expect(decide({ ...home, language: 'uk-UA' })).toBe('/uk/');
    expect(decide({ ...home, language: 'be' })).toBe('/be/');
    expect(decide({ ...home, language: 'kk-KZ' })).toBe('/kk/');
    expect(decide({ ...home, language: 'ka' })).toBe('/ka/');
    for (const choice of ['ru', 'en', 'uk']) {
      expect(decide({ ...home, choice, language: 'en-US' })).toBeNull();
    }

    expect(decide({ ...home, pathname: '/en/', language: 'en-US' })).toBeNull();
    expect(decide({ ...home, pathname: '/en', language: 'de' })).toBeNull();
    expect(decide({ ...home, pathname: '/en/index.html', language: 'en' })).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://omp-player.online';
const RU = 'ops/vps/site/privacy/index.html';
const EN = 'ops/vps/site/privacy/en/index.html';
const HOME_RU = 'ops/vps/site/index.html';
const HOME_EN = 'ops/vps/site/en/index.html';
const CYRILLIC = /\p{Script=Cyrillic}/u;
const DASH = /[\u2013\u2014]/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SUPPORT_EMAIL = 'ompplayerandroid@gmail.com';

const doc = (file: string) => new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'text/html');

function hrefs(file: string) {
  return new Set([...doc(file).querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
}

describe('privacy policy pages', () => {
  const ru = doc(RU);
  const en = doc(EN);
  const published = new Set([...hrefs(HOME_RU), ...hrefs(HOME_EN)]);

  it('serves Russian at /privacy and English at /privacy/en with a language switch', () => {
    expect(ru.documentElement.lang).toBe('ru');
    expect(en.documentElement.lang).toBe('en');
    expect(ru.querySelectorAll('h1')).toHaveLength(1);
    expect(en.querySelectorAll('h1')).toHaveLength(1);
    expect(ru.querySelector('h1')?.textContent).toBe('Политика конфиденциальности');
    expect(en.querySelector('h1')?.textContent).toBe('Privacy policy');
    expect(ru.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${ORIGIN}/privacy`);
    expect(en.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${ORIGIN}/privacy/en`);
    for (const page of [ru, en]) {
      const alts = [...page.querySelectorAll('link[rel="alternate"]')].map(
        (link) => `${link.getAttribute('hreflang')} ${link.getAttribute('href')}`,
      );
      expect(alts).toEqual([`ru ${ORIGIN}/privacy`, `en ${ORIGIN}/privacy/en`, `x-default ${ORIGIN}/privacy`]);
      expect(page.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('index, follow');
    }
    expect(ru.querySelector('.lang-switch a[aria-current="page"]')?.getAttribute('href')).toBe('/privacy');
    expect(en.querySelector('.lang-switch a[aria-current="page"]')?.getAttribute('href')).toBe('/privacy/en');
    expect(ru.querySelector('.lang-switch a[hreflang="en"]')?.getAttribute('href')).toBe('/privacy/en');
    expect(en.querySelector('.lang-switch a[hreflang="ru"]')?.getAttribute('href')).toBe('/privacy');
  });

  it('keeps the English page free of Cyrillic and both pages free of dashes', () => {
    expect(en.documentElement.outerHTML).not.toMatch(CYRILLIC);
    for (const file of [RU, EN, 'docs/lg-store-submission/privacy-policy.md']) {
      const text = readFileSync(file, 'utf8');
      const found = [...text.matchAll(new RegExp(EMAIL.source, 'gi'))].map((m) => m[0]);
      expect(text).not.toMatch(DASH);
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((address) => address === SUPPORT_EMAIL)).toBe(true);
    }
  });

  it('states the seven policy topics and a support block that reuses footer contacts', () => {
    expect([...ru.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      '1. Ваши медиа и история остаются в вашей сети',
      '2. Диагностика выключена, пока её не включат',
      '3. Метаданные (TMDB)',
      '4. Аккаунт не требуется',
      '5. Что мы не собираем',
      '6. Дети',
      '7. Изменения',
      '8. Поддержка',
    ]);
    expect([...en.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      '1. Your media and history stay on your network',
      '2. Optional diagnostics (off until you turn it on)',
      '3. Metadata (TMDB)',
      '4. No account required',
      '5. Data we do not collect',
      '6. Children',
      '7. Changes',
      '8. Support',
    ]);
    for (const page of [ru, en]) {
      const support = [...page.querySelectorAll('#support a')].map((a) => a.getAttribute('href'));
      expect(support).toContain(`mailto:${SUPPORT_EMAIL}`);
      for (const href of support) {
        if (href === `mailto:${SUPPORT_EMAIL}`) continue;
        expect(published.has(href)).toBe(true);
      }
      expect(page.documentElement.outerHTML).not.toMatch(/указать контакт|placeholder|TODO|черновик|\[draft\]/i);
      expect(page.documentElement.outerHTML).not.toContain('app.js');
      for (const m of page.documentElement.outerHTML.matchAll(/(?:src|href)="([^"]+)"/g)) {
        const href = m[1];
        expect(href === `mailto:${SUPPORT_EMAIL}` || /^(\/|https:\/\/|#)/.test(href), href).toBe(true);
      }
    }
  });

  it('links the policy from each landing footer in that page language', () => {
    expect(doc(HOME_RU).querySelector('nav[aria-label="Проект"] a[href="/privacy"]')?.textContent).toBe(
      'Политика конфиденциальности',
    );
    expect(doc(HOME_EN).querySelector('nav[aria-label="Project"] a[href="/privacy/en"]')?.textContent).toBe(
      'Privacy policy',
    );
    expect(readFileSync('docs/lg-store-submission/README.md', 'utf8')).toContain(`${ORIGIN}/privacy`);
    expect(readFileSync('docs/lg-store-submission/README.md', 'utf8')).toContain(`${ORIGIN}/privacy/en`);
  });
});

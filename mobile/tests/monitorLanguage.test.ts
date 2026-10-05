import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});
afterEach(() => localStorage.clear());

describe('the background monitor page applies the stored language', () => {
  it('language "en" in tsp.settings gives English texts before anything is built', async () => {
    localStorage.setItem('tsp.settings', JSON.stringify({ language: 'en' }));
    const i18n = await import('../../src/i18n');
    i18n.applyLanguageSetting('ru'); // what the test setup pins
    expect(i18n.lang.value).toBe('ru');
    await import('../src/monitor/main'); // outside Android's monitor WebView it only loads the entry
    expect(i18n.lang.value).toBe('en');
    const text = await import('../src/monitor/text');
    expect(text.summaryLines({ found: 2, checked: 1, failed: 0 } as never, Date.now()).join(' ')).toContain('New: 2');
  });

  it('language "ru" keeps Russian', async () => {
    localStorage.setItem('tsp.settings', JSON.stringify({ language: 'ru' }));
    const i18n = await import('../../src/i18n');
    await import('../src/monitor/main');
    expect(i18n.lang.value).toBe('ru');
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { lang, resolveLanguage, applyLanguageSetting, t, tp, fmtNumber, fmtSize, fmtDuration } from '../../src/i18n';

afterEach(() => applyLanguageSetting('ru'));

describe('language', () => {
  it('system: Russian for ru/uk/be/kk, English otherwise', () => {
    expect(resolveLanguage('system', ['ru-RU'])).toBe('ru');
    expect(resolveLanguage('system', ['uk'])).toBe('ru');
    expect(resolveLanguage('system', ['kk-KZ', 'en'])).toBe('ru');
    expect(resolveLanguage('system', ['de-DE', 'ru'])).toBe('en');
    expect(resolveLanguage('system', [])).toBe('en');
    expect(resolveLanguage('en', ['ru-RU'])).toBe('en');
  });
});

describe('t and tp', () => {
  it('fills placeholders, follows the language', () => {
    expect(t('common.signInTo', { site: 'Kinozal' })).toBe('Вход на Kinozal');
    applyLanguageSetting('en');
    expect(lang.value).toBe('en');
    expect(t('common.signInTo', { site: 'Kinozal' })).toBe('Sign in to Kinozal');
  });
  it('plurals by each language rule', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => tp('common.torrents', n))).toEqual(['1 раздача', '2 раздачи', '5 раздач', '11 раздач', '21 раздача', '22 раздачи', '25 раздач']);
    applyLanguageSetting('en');
    expect([1, 2].map((n) => tp('common.torrents', n))).toEqual(['1 torrent', '2 torrents']);
  });
  it('formats numbers, sizes and durations', () => {
    expect(fmtNumber(7.4, 1)).toBe('7,4');
    expect(fmtSize(8.2 * 1024 ** 3)).toBe('8,2 ГБ');
    expect(fmtDuration(118)).toBe('1 ч 58 мин');
    applyLanguageSetting('en');
    expect(fmtNumber(7.4, 1)).toBe('7.4');
    expect(fmtSize(8.2 * 1024 ** 3)).toBe('8.2 GB');
    expect(fmtDuration(118)).toBe('1 h 58 min');
  });
  it('an unknown key at runtime shows the key, never throws', () => {
    expect(t('nope.nothing' as never)).toBe('nope.nothing');
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { lang } from '../../src/i18n';
import { resultSizeText } from '../../src/sources/resultSize';

afterEach(() => {
  lang.value = 'ru';
});

describe('search row size in the UI language', () => {
  it('parses the site text and formats it like the torrent screen', () => {
    expect(resultSizeText({ Size: '69.35 GB' })).toBe('69,4 ГБ');
    expect(resultSizeText({ Size: '1,37 ГБ' })).toBe('1,4 ГБ');
    expect(resultSizeText({ Size: '700 MB' })).toBe('700 МБ');
    lang.value = 'en';
    expect(resultSizeText({ Size: '69.35 GB' })).toBe('69.4 GB');
  });

  it('prefers sizeBytes and keeps text it cannot read', () => {
    expect(resultSizeText({ Size: 'x', sizeBytes: 2 * 1024 * 1024 * 1024 })).toBe('2,0 ГБ');
    expect(resultSizeText({ Size: 'n/a' })).toBe('n/a');
    expect(resultSizeText({ Size: '' })).toBe('');
  });
});

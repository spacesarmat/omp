import { describe, expect, it } from 'vitest';
import { DICTS, dictVersion, lang, loadDict, t } from '../../src/i18n';
import { uk } from '../../src/i18n/uk';

describe('language packs load on demand', () => {
  it('the bundle carries only ru and en', () => {
    expect(Object.keys(DICTS).sort()).toEqual(['en', 'ru']);
  });

  it('loads the pack of a language and tells the screens to draw it', async () => {
    const before = dictVersion.value;
    await loadDict('uk');
    expect(!!DICTS.uk).toBe(true);
    expect(dictVersion.value).toBe(before + 1);
    lang.value = 'uk';
    expect(t('nav.library')).toBe(uk.nav.library);
    lang.value = 'ru';
  });

  it('a second call joins the finished load and asks for no redraw', async () => {
    await loadDict('kk');
    const v = dictVersion.value;
    await loadDict('kk');
    expect(dictVersion.value).toBe(v);
  });

  it('ru and en are already there, so nothing loads', async () => {
    const v = dictVersion.value;
    await loadDict('ru');
    await loadDict('en');
    expect(dictVersion.value).toBe(v);
  });
});

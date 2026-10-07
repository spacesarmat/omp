import { describe, it, expect } from 'vitest';
import { dubText, dubValue, dubChoices, dubPatch, DUB_RESET } from '../../src/ui/seriesDub';
import { applyLanguageSetting } from '../../src/i18n';

const k = [{ l: 'LostFilm', g: 'ru' }, { l: 'HDrezka Studio', g: 'ru' }];

describe('«Озвучка» choices', () => {
  it('a dub among the seen ones is the current entry', () => {
    const rec = { at: 1, l: 'lostfilm', g: 'ru', k };
    expect(dubText(rec)).toBe('lostfilm');
    expect(dubValue(rec)).toBe('k0');
    expect(dubChoices(rec).map((c) => c.value)).toEqual(['k0', 'k1', DUB_RESET]);
  });

  it('a language without a dub title has its own entry, marked current (not the reset)', () => {
    const rec = { at: 1, g: 'ru', k };
    expect(dubText(rec)).toBe('Русский');
    expect(dubValue(rec)).toBe('g:ru');
    const list = dubChoices(rec);
    expect(list[0]).toEqual({ label: 'Русский', value: 'g:ru' });
    expect(list.map((c) => c.value)).toEqual(['g:ru', 'k0', 'k1', DUB_RESET]);
    expect(dubPatch(rec, 'g:ru')).toEqual({ l: '', g: 'ru' });
  });

  it('a dub missing from the seen list is offered too', () => {
    const rec = { at: 1, l: 'Kubik', g: 'ru' };
    expect(dubValue(rec)).toBe('l');
    expect(dubChoices(rec)[0]).toEqual({ label: 'Kubik · Русский', value: 'l' });
    expect(dubPatch(rec, 'l')).toEqual({ l: 'Kubik', g: 'ru' });
  });

  it('shows the channels with the dub: «HDRezka · 5.1», 2.0 as «стерео»; older records without them as before', () => {
    const seen = [{ l: 'HDRezka', g: 'ru', c: '5.1' }, { l: 'LostFilm', g: 'ru', c: '2.0' }, { l: 'Kubik', g: 'ru' }, { l: 'Mono', g: 'en', c: '1.0' }];
    expect(dubText({ at: 1, l: 'HDRezka', g: 'ru', c: '5.1', k: seen })).toBe('HDRezka · 5.1');
    expect(dubText({ at: 1, l: 'LostFilm', g: 'ru', c: '2.0' })).toBe('LostFilm · стерео');
    // an older record without `c`: the channels seen with that dub, else the name alone
    expect(dubText({ at: 1, l: 'hdrezka', g: 'ru', k: seen })).toBe('hdrezka · 5.1');
    expect(dubText({ at: 1, l: 'Kubik', g: 'ru', k: seen })).toBe('Kubik');
    expect(dubChoices({ at: 1, l: 'HDRezka', g: 'ru', c: '5.1', k: seen }).map((c) => c.label))
      .toEqual(['HDRezka · 5.1 · Русский', 'LostFilm · стерео · Русский', 'Kubik · Русский', 'Mono · моно · English', 'По умолчанию (сбросить)']);
    // a choice keeps the channels with the dub
    expect(dubPatch({ at: 1, k: seen }, 'k0')).toEqual({ l: 'HDRezka', g: 'ru', c: '5.1' });
    expect(dubPatch({ at: 1, k: seen }, 'k2')).toEqual({ l: 'Kubik', g: 'ru' });
    applyLanguageSetting('en');
    expect(dubText({ at: 1, l: 'LostFilm', g: 'ru', c: '2.0' })).toBe('LostFilm · stereo');
    applyLanguageSetting('ru');
  });

  it('nothing remembered or a reset: «по умолчанию», the reset is current', () => {
    expect(dubValue(null)).toBe(DUB_RESET);
    expect(dubValue({ at: 1, k, x: true })).toBe(DUB_RESET);
    expect(dubText({ at: 1, x: true })).toBe('по умолчанию');
    expect(dubChoices(null)).toEqual([{ label: 'По умолчанию (сбросить)', value: DUB_RESET }]);
    expect(dubPatch(null, DUB_RESET)).toBe('reset');
    expect(dubPatch(null, 'k3')).toBeNull();
  });
});

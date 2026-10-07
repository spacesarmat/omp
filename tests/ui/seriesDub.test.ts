import { describe, it, expect } from 'vitest';
import { dubText, dubValue, dubChoices, dubPatch, DUB_RESET } from '../../src/ui/seriesDub';

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

  it('nothing remembered or a reset: «по умолчанию», the reset is current', () => {
    expect(dubValue(null)).toBe(DUB_RESET);
    expect(dubValue({ at: 1, k, x: true })).toBe(DUB_RESET);
    expect(dubText({ at: 1, x: true })).toBe('по умолчанию');
    expect(dubChoices(null)).toEqual([{ label: 'По умолчанию (сбросить)', value: DUB_RESET }]);
    expect(dubPatch(null, DUB_RESET)).toBe('reset');
    expect(dubPatch(null, 'k3')).toBeNull();
  });
});

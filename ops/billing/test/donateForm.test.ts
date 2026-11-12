import { describe, expect, it } from 'vitest';
import { donateSaveFailed, formFromDonateSettings, keepOrRefreshForm, stillDirtyAfterSave, takeFilterRows } from '../admin/src/lib/donateForm.ts';

describe('donate admin form', () => {
  it('keeps unsaved edits and takes a normalized server copy once the form is clean', () => {
    const local = formFromDonateSettings({ enabled: true, minRub: 10, maxRub: 5, amounts: '10,20' });
    const typed = { ...local, minRub: '10' };
    const incoming = formFromDonateSettings({ enabled: true, minRub: 10, maxRub: 10, amounts: '10' });
    expect(keepOrRefreshForm(typed, incoming, true)).toEqual(typed);
    expect(keepOrRefreshForm(typed, incoming, false).maxRub).toBe('10');
    expect(keepOrRefreshForm(typed, incoming, false).amounts).toBe('10');
  });

  it('keeps newer edits that happened while a save was in flight', () => {
    const sent = formFromDonateSettings({ enabled: true, minRub: 50, thanksText: 'Спасибо' });
    const typed = { ...sent, thanksText: 'Спасибо вам' };
    expect(stillDirtyAfterSave(typed, sent, false)).toBe(true);
    expect(stillDirtyAfterSave(sent, sent, false)).toBe(false);
    expect(stillDirtyAfterSave(sent, sent, true)).toBe(true);
    expect(donateSaveFailed(undefined)).toBe(true);
    expect(donateSaveFailed({ ok: false })).toBe(true);
    expect(donateSaveFailed({ ok: true, flash: { error: 'нет' } })).toBe(true);
    expect(donateSaveFailed({ ok: true })).toBe(false);
  });

  it('fills auto switches from the server view and keeps a typed star price while dirty', () => {
    const rates = {
      refreshMin: 12,
      maxAgeMin: 360,
      markupPercent: 10,
      starUsd: 0.013,
      rows: {
        star: { auto: false, manual: 2, value: 2, source: 'manual', at: 0, usable: true, last: 0 },
        usdt: { auto: true, manual: 0, value: 92.5, source: 'cryptopay', at: 1, usable: true, last: 92.5 },
        ton: { auto: true, manual: 0, value: 0, source: '', at: 0, usable: false, last: 0 },
        btc: { auto: true, manual: 40, value: 0, source: '', at: 0, usable: false, last: 0 },
      },
    };
    const form = formFromDonateSettings({ rubPerStar: 9 }, rates);
    expect(form.autoStar).toBe(false);
    expect(form.rubPerStar).toBe('2');
    expect(form.autoUsdt).toBe(true);
    expect(form.cryptoRateUsdt).toBe('0');
    expect(form.cryptoRateBtc).toBe('40');
    expect(form.starUsd).toBe('0.013');
    expect(form.markupPercent).toBe('10');
    expect(form.maxAgeHours).toBe('6');
    const typed = { ...form, starUsd: '0.02' };
    expect(keepOrRefreshForm(typed, form, true).starUsd).toBe('0.02');
    expect(keepOrRefreshForm(typed, form, false).starUsd).toBe('0.013');
  });

  it('drops a filter response that belongs to an older selection', () => {
    expect(takeFilterRows(1, 2, [{ id: 'paid' }])).toBeUndefined();
    expect(takeFilterRows(2, 2, null)).toBeNull();
    expect(takeFilterRows(2, 2, [{ id: 'paid' }])).toEqual([{ id: 'paid' }]);
  });
});

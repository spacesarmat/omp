import { describe, expect, it } from 'vitest';
import { formFromDonateSettings, keepOrRefreshForm, takeFilterRows } from '../admin/src/lib/donateForm.ts';

describe('donate admin form', () => {
  it('keeps unsaved edits and takes a normalized server copy once the form is clean', () => {
    const local = formFromDonateSettings({ enabled: true, minRub: 10, maxRub: 5, amounts: '10,20' });
    const typed = { ...local, minRub: '10' };
    const incoming = formFromDonateSettings({ enabled: true, minRub: 10, maxRub: 10, amounts: '10' });
    expect(keepOrRefreshForm(typed, incoming, true)).toEqual(typed);
    expect(keepOrRefreshForm(typed, incoming, false).maxRub).toBe('10');
    expect(keepOrRefreshForm(typed, incoming, false).amounts).toBe('10');
  });

  it('drops a filter response that belongs to an older selection', () => {
    expect(takeFilterRows(1, 2, [{ id: 'paid' }])).toBeUndefined();
    expect(takeFilterRows(2, 2, null)).toBeNull();
    expect(takeFilterRows(2, 2, [{ id: 'paid' }])).toEqual([{ id: 'paid' }]);
  });
});

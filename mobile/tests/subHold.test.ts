import { beforeEach, describe, expect, it } from 'vitest';
import { checkCount, isSubHeld, rememberCheck, setSubHeld, withoutHeld } from '../src/monitor/subHold';

beforeEach(() => localStorage.clear());

describe('manual subscription pause and check count', () => {
  it('drops a held subscription from a check list', () => {
    setSubHeld('a', true);
    expect(isSubHeld('a')).toBe(true);
    expect(withoutHeld([{ id: 'a' }, { id: 'b' }]).map((s) => s.id)).toEqual(['b']);
    setSubHeld('a', false);
    expect(withoutHeld([{ id: 'a' }])).toHaveLength(1);
  });

  it('keeps counting after the stored timestamps are capped', () => {
    for (let i = 0; i < 9; i++) rememberCheck('s', i);
    expect(checkCount('s')).toBe(9);
  });
});

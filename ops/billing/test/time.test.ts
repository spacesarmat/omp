import { describe, expect, it } from 'vitest';
import { actorLine } from '../admin/src/lib/text.ts';
import { clock, dayTitle, exactStamp, groupByDay, listStamp } from '../admin/src/lib/time.ts';

const DAY = 24 * 60 * 60 * 1000;
// 2026-10-18 07:05:09 UTC = 10:05:09 MSK
const AT = Date.UTC(2026, 9, 18, 7, 5, 9);

describe('moscow stamps', () => {
  it('formats clock, list, exact and day titles', () => {
    expect(clock(AT)).toBe('10:05');
    expect(listStamp(AT)).toBe('18.10.2026 10:05');
    expect(exactStamp(AT)).toBe('18 октября 2026, 10:05:09 МСК');
    expect(dayTitle(AT, AT + 60 * 60 * 1000)).toBe('Сегодня');
    expect(dayTitle(AT, AT + DAY)).toBe('Вчера');
    expect(dayTitle(AT, AT + 2 * DAY)).toBe('18 октября 2026');
  });

  it('rolls the calendar at Moscow midnight', () => {
    const midnight = Date.UTC(2026, 9, 18, 21, 0, 1);
    expect(clock(midnight)).toBe('00:00');
    expect(dayTitle(midnight, midnight)).toBe('Сегодня');
    expect(dayTitle(AT, midnight)).toBe('Вчера');
  });

  it('groups newest-first items under day headers', () => {
    const groups = groupByDay(
      [
        { at: AT + DAY, id: 'tomorrow' },
        { at: AT + 1000, id: 'later' },
        { at: AT, id: 'early' },
        { at: 0, id: 'none' },
      ],
      AT + DAY,
    );
    expect(groups.map((g) => g.title)).toEqual(['Сегодня', 'Вчера', 'Без даты']);
    expect(groups[1].items.map((row) => row.id)).toEqual(['later', 'early']);
  });
});

describe('actor line', () => {
  it('names the kind and keeps the device next to a user', () => {
    expect(actorLine({ kind: 'user', label: '@nick · 42' }, { deviceId: 'abcdef0123456789' })).toBe(
      'пользователь · @nick · 42 · устройство abcdef01',
    );
    expect(actorLine({ kind: 'device', label: 'abcdef01' })).toBe('устройство · abcdef01');
    expect(actorLine({ kind: 'admin', id: 'cli', label: 'cli' })).toBe('админ · cli');
    expect(actorLine(null, { fallback: 'админ' })).toBe('админ');
  });
});

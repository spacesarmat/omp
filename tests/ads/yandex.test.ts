import { beforeEach, describe, expect, it } from 'vitest';
import { adPositions } from '../../src/ads/ads';
import {
  YANDEX_DEMO_UNIT,
  YANDEX_OFF,
  groupFor,
  groupPlacement,
  impressionsLeft,
  installReady,
  noteYandexImpression,
  resetYandexCaps,
  sanitizeYandexAds,
  slotFill,
  tvLinkedMode,
  yandexSlotId,
  yandexUnit,
} from '../../src/ads/yandex';

const NOW = Date.UTC(2026, 10, 19, 9, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetYandexCaps();
});

describe('yandex config normalization', () => {
  it('is off when the field is missing, with the free group on and the subscription group off', () => {
    expect(sanitizeYandexAds(undefined)).toEqual(YANDEX_OFF);
    expect(YANDEX_OFF.enabled).toBe(false);
    expect(YANDEX_OFF.fallbackHouse).toBe(true);
    expect(YANDEX_OFF.groups.free).toEqual({ enabled: true, everyN: 10, afterInstallDays: 3, maxPerSession: 0, maxPerDay: 0 });
    expect(YANDEX_OFF.groups.sub.enabled).toBe(false);
  });

  it('drops a bad unit, a bad frequency and a bad cap back to the defaults', () => {
    const y = sanitizeYandexAds({
      enabled: true,
      fallbackHouse: false,
      androidUnit: 'not-a-unit',
      iosUnit: 'R-M-123456-1',
      groups: {
        free: { enabled: false, everyN: 2, afterInstallDays: 99, maxPerSession: -1, maxPerDay: 3 },
        sub: { enabled: 'yes', everyN: '12', afterInstallDays: '0', maxPerSession: '4', maxPerDay: '0' },
      },
    });
    expect(y.enabled).toBe(true);
    expect(y.fallbackHouse).toBe(false);
    expect(y.androidUnit).toBe('');
    expect(y.iosUnit).toBe('R-M-123456-1');
    expect(y.groups.free).toEqual({ enabled: false, everyN: 10, afterInstallDays: 3, maxPerSession: 0, maxPerDay: 3 });
    expect(y.groups.sub).toEqual({ enabled: true, everyN: 12, afterInstallDays: 0, maxPerSession: 4, maxPerDay: 0 });
  });

  it('keeps the official demo unit ids and an R-M unit', () => {
    const y = sanitizeYandexAds({ androidUnit: 'demo-native-content-yandex', iosUnit: 'demo-native-app-yandex' });
    expect(y.androidUnit).toBe('demo-native-content-yandex');
    expect(y.iosUnit).toBe('demo-native-app-yandex');
  });
});

describe('which group applies', () => {
  const on = sanitizeYandexAds({
    enabled: true,
    groups: {
      free: { enabled: true, everyN: 8, afterInstallDays: 1, maxPerSession: 0, maxPerDay: 0 },
      sub: { enabled: true, everyN: 20, afterInstallDays: 5, maxPerSession: 1, maxPerDay: 2 },
    },
  });

  it('uses the free group without a subscription and the subscription group with one', () => {
    expect(groupFor(on, false)?.everyN).toBe(8);
    expect(groupFor(on, true)?.everyN).toBe(20);
    expect(groupFor(sanitizeYandexAds({ enabled: true, groups: { sub: { enabled: false } } }), true)).toBeNull();
    expect(groupFor(YANDEX_OFF, false)).toBeNull();
  });

  it('a TV linked to a subscribed phone follows the subscription group, and only while Yandex is on', () => {
    expect(tvLinkedMode(on, true)).toBe('show');
    expect(tvLinkedMode(sanitizeYandexAds({ enabled: true, groups: { sub: { enabled: false } } }), true)).toBe('hide');
    expect(tvLinkedMode(on, false)).toBe('legacy');
    expect(tvLinkedMode(YANDEX_OFF, true)).toBe('legacy');
  });

  it('waits the group delay after install and places the first card after N, then every N', () => {
    const free = on.groups.free;
    expect(installReady(free, NOW, NOW)).toBe(false);
    expect(installReady(free, NOW - DAY, NOW)).toBe(true);
    const place = groupPlacement(free);
    expect(place).toEqual({ everyN: 8, firstAfter: 8 });
    expect(adPositions(40, { ...place, maxPerScreen: 1 }, 3)).toEqual([8, 16, 24, 32]);
  });
});

describe('impression caps', () => {
  const group = { enabled: true, everyN: 10, afterInstallDays: 0, maxPerSession: 2, maxPerDay: 3 };

  it('zero means no cap, and a shown impression spends session and day room', () => {
    expect(impressionsLeft({ ...group, maxPerSession: 0, maxPerDay: 0 }, 'free', NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(impressionsLeft(group, 'free', NOW)).toBe(2);
    noteYandexImpression('free', NOW);
    expect(impressionsLeft(group, 'free', NOW)).toBe(1);
    noteYandexImpression('free', NOW);
    expect(impressionsLeft(group, 'free', NOW)).toBe(0);
    expect(impressionsLeft(group, 'sub', NOW)).toBe(2);
  });

  it('the day counter does not carry into the next Moscow day', () => {
    noteYandexImpression('free', NOW);
    noteYandexImpression('free', NOW);
    noteYandexImpression('free', NOW);
    expect(impressionsLeft(group, 'free', NOW)).toBe(0);
    resetYandexCaps();
    noteYandexImpression('free', NOW);
    noteYandexImpression('free', NOW);
    noteYandexImpression('free', NOW);
    const next = NOW + DAY;
    expect(impressionsLeft({ ...group, maxPerSession: 0 }, 'free', next)).toBe(3);
  });
});

describe('what fills the card', () => {
  it('prefers a loaded Yandex ad, then the own banner, then nothing', () => {
    expect(slotFill({ yandexReady: true, yandexFailed: false, house: true, fallback: true })).toBe('yandex');
    expect(slotFill({ yandexReady: false, yandexFailed: true, house: true, fallback: true })).toBe('house');
    expect(slotFill({ yandexReady: false, yandexFailed: true, house: true, fallback: false })).toBe('none');
    expect(slotFill({ yandexReady: false, yandexFailed: true, house: false, fallback: true })).toBe('none');
    expect(slotFill({ yandexReady: false, yandexFailed: false, house: true, fallback: true })).toBe('none');
  });

  it('builds a short slot id that does not include the filter key', () => {
    const id = yandexSlotId(12, 4);
    const longKey = 'discover|sort|genre,genre,genre,genre,genre,genre';
    expect(id.length).toBeLessThan(40);
    expect(id.indexOf(longKey)).toBe(-1);
    expect(yandexSlotId(12, 4)).toBe(id);
    expect(yandexSlotId(12, 5)).not.toBe(id);
  });

  it('uses the demo unit until the admin pastes a real one', () => {
    expect(yandexUnit(YANDEX_OFF, 'android')).toBe(YANDEX_DEMO_UNIT);
    expect(yandexUnit(YANDEX_OFF, 'ios')).toBe(YANDEX_DEMO_UNIT);
    const y = sanitizeYandexAds({ androidUnit: 'R-M-999-1', iosUnit: '' });
    expect(yandexUnit(y, 'android')).toBe('R-M-999-1');
    expect(yandexUnit(y, 'ios')).toBe(YANDEX_DEMO_UNIT);
  });
});

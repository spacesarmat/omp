import { describe, it, expect } from 'vitest';
import {
  activeMethods,
  DONATE_METHODS,
  DONATE_QR_URL,
  DONATE_URL,
  parseSupportCode,
  qrMethodActive,
  supportActive,
  supportEndText,
  supportUntil,
  SUPPORT_GRACE_MS,
  SUPPORT_PUBLIC_KEY,
} from '../../src/lib/donate';

const SIG = 'A'.repeat(86);

describe('shared donate config', () => {
  it('Boosty is the QR link and a configured method', () => {
    expect(DONATE_QR_URL).toBe(DONATE_URL);
    expect(activeMethods().map((m) => m.id)).toEqual(['boosty']);
    expect(qrMethodActive(DONATE_QR_URL)).toBe(true);
  });
  it('no card when no method opens the QR link', () => {
    expect(qrMethodActive(DONATE_QR_URL, DONATE_METHODS.map((m) => ({ ...m, url: '' })))).toBe(false);
    expect(qrMethodActive('')).toBe(false);
    expect(qrMethodActive('https://elsewhere.example/x')).toBe(false);
  });
  it('the public key is 32 raw bytes in base64url', () => {
    expect(SUPPORT_PUBLIC_KEY).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('parseSupportCode', () => {
  it('reads the month and the signature, ignoring spaces and padding', () => {
    expect(parseSupportCode('  OMP-2026-11-' + SIG + '==\n')).toEqual({ month: '2026-11', year: 2026, mon: 11, sig: SIG });
  });
  it('rejects malformed codes', () => {
    const bad = [
      '',
      'OMP-2026-11',
      'OMP-2026-13-' + SIG,
      'OMP-2026-00-' + SIG,
      'OMP-26-11-' + SIG,
      'OMP-2026-11-' + SIG.slice(1),
      'XYZ-2026-11-' + SIG,
      'OMP-2026-11-' + SIG.slice(1) + '!',
    ];
    bad.forEach((c) => expect(parseSupportCode(c)).toBeNull());
  });
});

describe('support end time', () => {
  it('a month ends at the 1st of the next one plus the grace', () => {
    expect(supportUntil(2026, 11)).toBe(new Date(2026, 11, 1).getTime() + SUPPORT_GRACE_MS);
    expect(supportUntil(2026, 12)).toBe(new Date(2027, 0, 1).getTime() + SUPPORT_GRACE_MS);
  });
  it('«до 30 ноября»: the last day of the month, without the grace days', () => {
    expect(supportEndText(supportUntil(2026, 11))).toBe('30 ноября');
    expect(supportEndText(supportUntil(2027, 2))).toBe('28 февраля');
  });
  it('active only before the end and not unbelievably far ahead', () => {
    const now = new Date(2026, 9, 4).getTime();
    expect(supportActive(supportUntil(2026, 10), now)).toBe(true);
    expect(supportActive(supportUntil(2026, 11), now)).toBe(true);
    expect(supportActive(now - 1, now)).toBe(false);
    expect(supportActive(0, now)).toBe(false);
    expect(supportActive(now + 400 * 86400000, now)).toBe(false);
    expect(supportActive(NaN, now)).toBe(false);
  });
});

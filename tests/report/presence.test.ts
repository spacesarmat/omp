import { describe, expect, it } from 'vitest';
import { emptyPresence, nextSteps, presenceFields } from '../../src/report/presence';

describe('presence contract', () => {
  it('sends install once, then login and payment, and skips steps when diagnostics are off', () => {
    const first = nextSteps(emptyPresence(), { linked: false, active: false }, true);
    expect(first.steps).toEqual(['install']);
    const login = nextSteps(first.next, { linked: true, active: false }, true);
    expect(login.steps).toEqual(['login']);
    const pay = nextSteps(login.next, { linked: true, active: true }, true);
    expect(pay.steps).toEqual(['payment']);
    const again = nextSteps(pay.next, { linked: true, active: false }, true);
    const renew = nextSteps(again.next, { linked: true, active: true }, true);
    expect(renew.steps).toEqual(['renewal']);
    const quiet = nextSteps(emptyPresence(), { linked: true, active: true }, false);
    expect(quiet.steps).toEqual([]);
    expect(quiet.next.install).toBe(true);
  });

  it('posts the fields the billing route reads', () => {
    expect(presenceFields('0.20.12', 'androidtv', true, ['install', 'login'])).toEqual({
      version: '0.20.12',
      platform: 'androidtv',
      diagnostics: '1',
      events: 'install,login',
    });
  });
});

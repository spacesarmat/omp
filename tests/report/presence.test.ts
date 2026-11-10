import { describe, expect, it } from 'vitest';
import { emptyPresence, nextSteps, presenceFields } from '../../src/report/presence';

describe('presence contract', () => {
  it('sends install and login only, and skips them when diagnostics are off', () => {
    const first = nextSteps(emptyPresence(), { linked: false }, true);
    expect(first.steps).toEqual(['install']);
    const login = nextSteps(first.next, { linked: true }, true);
    expect(login.steps).toEqual(['login']);
    const again = nextSteps(login.next, { linked: true }, true);
    expect(again.steps).toEqual([]);
    const quiet = nextSteps(emptyPresence(), { linked: true }, false);
    expect(quiet.steps).toEqual([]);
    expect(quiet.next.install).toBe(true);
    expect(quiet.next.linked).toBe(true);
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

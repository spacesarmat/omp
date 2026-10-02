import { describe, it, expect } from 'vitest';
import { countdownDue } from '../../src/player/useNextEpisode';

describe('countdownDue', () => {
  it('is due in the last 30 s without credits', () => {
    expect(countdownDue({ time: 2900, duration: 2920 })).toBe(true);
    expect(countdownDue({ time: 2800, duration: 2920 })).toBe(false);
  });
  it('starts at the credits chapter when the file has one', () => {
    expect(countdownDue({ time: 2810, duration: 2920, creditsAt: 2800 })).toBe(true);
    expect(countdownDue({ time: 2790, duration: 2920, creditsAt: 2800 })).toBe(false);
  });
  it('ignores credits outside the file, short files and the very end', () => {
    expect(countdownDue({ time: 100, duration: 2920, creditsAt: 5000 })).toBe(false);
    expect(countdownDue({ time: 50, duration: 60, creditsAt: 10 })).toBe(false);
    expect(countdownDue({ time: 2920, duration: 2920, creditsAt: 2800 })).toBe(false);
  });
});

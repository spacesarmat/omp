import { describe, it, expect, afterEach } from 'vitest';
import { platformKind } from '../../src/platform/env';

const w = window as unknown as { Capacitor?: unknown };

describe('platformKind', () => {
  afterEach(() => {
    delete w.Capacitor;
  });

  it('is webos without Capacitor', () => {
    expect(platformKind()).toBe('webos');
  });

  it('is androidtv under Capacitor android', () => {
    w.Capacitor = { getPlatform: () => 'android' };
    expect(platformKind()).toBe('androidtv');
  });

  it('is webos for other Capacitor platforms or a broken stub', () => {
    w.Capacitor = { getPlatform: () => 'web' };
    expect(platformKind()).toBe('webos');
    w.Capacitor = {};
    expect(platformKind()).toBe('webos');
    w.Capacitor = {
      getPlatform: () => {
        throw new Error('x');
      },
    };
    expect(platformKind()).toBe('webos');
  });
});

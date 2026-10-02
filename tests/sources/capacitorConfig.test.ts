import { describe, it, expect } from 'vitest';
import config from '../../capacitor.config';

describe('capacitor.config', () => {
  // plugin call arguments and results (tracker passwords, cookies) must never reach logcat or the console
  it('turns Capacitor logging off in every build', () => {
    expect(config.loggingBehavior).toBe('none');
  });
});

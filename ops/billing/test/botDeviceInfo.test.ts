
import { describe, expect, it } from 'vitest';
import { parseAction } from '../src/bot.mjs';

describe('botNeedsDeviceInfo coverage via parseAction', () => {
  it('device commands parse as devices', () => {
    for (const t of ['Устройства', '/devices', '/device', '/unlink', '/start devices', '/code']) {
      expect(parseAction(t).action, t).toBe('devices');
    }
  });
  it('admin login is distinct', () => {
    expect(parseAction('/start admin_abc').action).toBe('admin_login');
    expect(parseAction('/promo CODE').action).toBe('promo');
  });
});

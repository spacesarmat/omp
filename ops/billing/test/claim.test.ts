import { describe, expect, it } from 'vitest';
import {
  activate,
  boundDevices,
  claimLinkedDevice,
  confirmDeviceLink,
  createSubscription,
  grantDays,
  issueActivation,
  openAccount,
  startDeviceLink,
} from '../src/logic.mjs';
import { claimLimitConfig } from '../src/services.mjs';
import { emptyState } from '../src/state.mjs';

const NOW = Date.parse('2026-10-19T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const DEV_C = 'c'.repeat(32);

function paid() {
  const opened = openAccount(emptyState(), { telegramId: '42', email: '', now: NOW });
  const created = createSubscription(opened.state, { accountId: opened.account.id, now: NOW, days: 30 });
  return { state: created.state, code: created.result.code as string, sub: created.result.subscriptionId as string, account: opened.account.id as string };
}

describe('claim by linked Telegram', () => {
  it('issues one binding from the bot link, again on the same device, and during grace', () => {
    const device = 'c'.repeat(32);
    const started = startDeviceLink(emptyState(), { deviceId: device, now: NOW });
    const linked = confirmDeviceLink(started.state, { token: started.result.token, telegramId: '77', now: NOW });
    expect(claimLinkedDevice(linked.state, { deviceId: device, now: NOW }).result.error).toBe('no_subscription');
    expect(claimLinkedDevice(emptyState(), { deviceId: device, now: NOW }).result.error).toBe('not_linked');
    const granted = grantDays(linked.state, { telegramId: '77', days: 3, now: NOW });
    const claimed = claimLinkedDevice(granted.state, { deviceId: device, now: NOW });
    expect(claimed.result.error).toBeUndefined();
    expect(claimed.result.token).toBe('');
    expect(claimed.result.codeId).toBeTruthy();
    const subId = claimed.state.subscriptions[0].id;
    expect(boundDevices(claimed.state, subId)).toBe(1);
    const again = claimLinkedDevice(claimed.state, { deviceId: device, now: NOW + 1 });
    expect(again.result.codeId).toBe(claimed.result.codeId);
    expect(boundDevices(again.state, subId)).toBe(1);
    const grace = {
      ...granted.state,
      subscriptions: granted.state.subscriptions.map((s: { paidUntil: number }) => ({ ...s, paidUntil: NOW - DAY })),
    };
    const inGrace = claimLinkedDevice(grace, { deviceId: device, now: NOW });
    expect(inGrace.result.error).toBeUndefined();
    expect(inGrace.result.codeId).toBeTruthy();
    const ended = {
      ...granted.state,
      subscriptions: granted.state.subscriptions.map((s: { paidUntil: number }) => ({ ...s, paidUntil: NOW - 10 * DAY })),
    };
    expect(claimLinkedDevice(ended, { deviceId: device, now: NOW }).result.error).toBe('no_subscription');
  });

  it('refuses a new device when every slot is taken and still renews a device that is already bound', () => {
    const start = paid();
    const a = activate(start.state, { code: start.code, deviceId: DEV_A, now: NOW });
    const second = issueActivation(a.state, { accountId: start.account, now: NOW });
    const b = activate(second.state, { code: second.result.code, deviceId: DEV_B, now: NOW });
    expect(b.result.error).toBeUndefined();
    const again = claimLinkedDevice(b.state, { deviceId: DEV_A, now: NOW });
    expect(again.result.error).toBeUndefined();
    expect(boundDevices(again.state, start.sub)).toBe(2);
    const started = startDeviceLink(b.state, { deviceId: DEV_C, now: NOW });
    const linked = confirmDeviceLink(started.state, { token: started.result.token, telegramId: '42', now: NOW });
    const refused = claimLinkedDevice(linked.state, { deviceId: DEV_C, now: NOW });
    expect(refused.result.error).toBe('device_limit');
    expect(boundDevices(refused.state, start.sub)).toBe(2);
  });

  it('reads the claim rate-limit defaults', () => {
    expect(claimLimitConfig({})).toEqual({ ipMax: 30, codeMax: 10, windowMs: 600000 });
    expect(claimLimitConfig({ BILLING_CLAIM_IP_MAX: '0', BILLING_CLAIM_DEVICE_MAX: '0' }).ipMax).toBe(0);
  });
});

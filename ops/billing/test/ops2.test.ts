import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { emptyState } from '../src/state.mjs';
import { createPromo, redeemPromo } from '../src/logic.mjs';
import { betaCohort, broadcastAudience, crashDraft, ingestCrash, setCrashStatus } from '../src/crashIn.mjs';
import { verifyDump } from '../src/pgBackup.mjs';

describe('promo, crashes, beta, backup list', () => {
  it('rejects an expired promo and keeps a discount as credit', () => {
    let state = emptyState();
    state.accounts = [{ id: 'a1', telegramId: '1' }];
    state.subscriptions = [{ id: 's1', accountId: 'a1', product: 'jackett', paidUntil: Date.now() + 86400000, creditRub: 0 }];
    state.settings.priceRub = 100;
    const made = createPromo(state, { code: 'SALE', days: 1, maxUses: 2, now: 10, expiresAt: 20, discountPercent: 10 });
    state = made.state;
    const late = redeemPromo(state, { code: 'SALE', accountId: 'a1', now: 30 });
    expect(late.result.error).toBe('expired');
    const open = createPromo(state, { code: 'NOW1', days: 1, maxUses: 2, now: 10, discountPercent: 10 });
    const used = redeemPromo(open.state, { code: 'NOW1', accountId: 'a1', now: 11 });
    expect(used.result.error).toBeUndefined();
    const sub = used.state.subscriptions.find((s) => s.id === 's1');
    expect(sub.creditRub).toBe(10);
  });

  it('a discount without bonus days does not grant a free day', () => {
    let state = emptyState();
    state.accounts = [{ id: 'a1' }];
    const until = 1_000_000;
    state.subscriptions = [{ id: 's1', accountId: 'a1', product: 'jackett', paidUntil: until, creditRub: 0 }];
    state.settings.priceRub = 100;
    const made = createPromo(state, { code: 'OFF10', days: 0, maxUses: 1, now: 10, discountPercent: 10 });
    expect(made.result.promo.days).toBe(0);
    const used = redeemPromo(made.state, { code: 'OFF10', accountId: 'a1', now: 11 });
    const sub = used.state.subscriptions.find((s) => s.id === 's1');
    expect(sub.paidUntil).toBe(until);
    expect(sub.creditRub).toBe(10);
  });

  it('groups crashes, flags a regression and writes an issue draft', () => {
    const first = ingestCrash(emptyState(), { message: 'boom', stack: 'at main\n', version: '1.0.0', platform: 'phone' }, 10);
    expect(first.alert).toBe('new');
    expect(first.state.crashGroups).toHaveLength(1);
    const again = ingestCrash(first.state, { message: 'boom', stack: 'at main\n', version: '1.0.0', platform: 'phone' }, 20);
    expect(again.state.crashGroups[0].count).toBe(2);
    const fixed = setCrashStatus(again.state, again.state.crashGroups[0].id, 'fixed');
    const back = ingestCrash(fixed.state, { message: 'boom', stack: 'at main\n', version: '1.2.0', platform: 'phone' }, 30);
    expect(back.alert).toBe('regression');
    expect(back.group.regression).toBe(true);
    expect(crashDraft(back.group)).toContain('Регрессия');
    const redacted = ingestCrash(emptyState(), { message: 'see magnet:?xt=urn:btih:abc Bearer secret', stack: '1.2.3.4' }, 1);
    expect(redacted.group.title).not.toContain('magnet:?');
    expect(redacted.group.title).not.toContain('1.2.3.4');
  });

  it('puts a stable share of devices into the beta and lists telegram audiences', () => {
    const id = 'device-1';
    expect(betaCohort(id, 100)).toBe(true);
    expect(betaCohort(id, 0)).toBe(false);
    expect(betaCohort(id, 10)).toBe(betaCohort(id, 10));
    const state = emptyState();
    state.accounts = [
      { id: 'a', telegramId: '10' },
      { id: 'b', telegramId: '20' },
    ];
    state.subscriptions = [{ id: 's', accountId: 'a', product: 'jackett', paidUntil: Date.now() + 1000 }];
    expect(broadcastAudience(state, 'active', Date.now())).toEqual(['10']);
    expect(broadcastAudience(state, 'lapsed', Date.now())).toEqual(['20']);
  });

  it('treats a pg_restore list failure as a failed check and does not restore', async () => {
    const result = await verifyDump('/tmp/missing.dump', () => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      child.stderr = new EventEmitter();
      setTimeout(() => child.emit('close', 1), 0);
      return child;
    });
    expect(result.ok).toBe(false);
  });
});

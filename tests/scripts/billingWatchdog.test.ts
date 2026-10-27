import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
import { evaluateHealth, monitorMaxAgeSec, runWatchdog, transition } from '../../scripts/billing-watchdog-lib.mjs';
import type { WatchdogState } from '../../scripts/billing-watchdog-lib.mjs';

const good = { ok: true, botPollEnabled: true, botPollOkAgoSec: 12, monitorScheduled: true, monitorAgoSec: 300, monitorIntervalMin: 15 };

describe('billing watchdog', () => {
  it('accepts a healthy answer, also from an older billing without the monitor fields', () => {
    expect(evaluateHealth({ status: 200, body: good })).toEqual({ ok: true, reason: '' });
    expect(evaluateHealth({ status: 200, body: { ok: true, botPollEnabled: true, botPollOkAgoSec: 5 } }).ok).toBe(true);
    expect(evaluateHealth({ status: 200, body: { ...good, monitorAgoSec: null } }).ok).toBe(true);
  });

  it('reports no answer, a bad status, a stuck bot and a late monitor', () => {
    expect(evaluateHealth({ error: 'TimeoutError' })).toEqual({ ok: false, reason: 'billing не отвечает (TimeoutError)' });
    expect(evaluateHealth({ status: 502, body: null }).reason).toBe('/health ответил HTTP 502');
    expect(evaluateHealth({ status: 200, body: { ...good, botPollOkAgoSec: 1200 } }).reason).toBe('бот не получал обновления 20 мин');
    expect(evaluateHealth({ status: 200, body: { ...good, botPollOkAgoSec: null } }).ok).toBe(false);
    expect(evaluateHealth({ status: 200, body: { ...good, monitorAgoSec: 3600 } }).reason).toBe('«Мониторинг» не запускался 60 мин');
    expect(evaluateHealth({ status: 200, body: { ...good, monitorScheduled: false, monitorAgoSec: 99999 } }).ok).toBe(true);
    // a first run that never finishes: no last run, but the schedule is on for too long
    expect(evaluateHealth({ status: 200, body: { ...good, monitorAgoSec: null, monitorScheduledAgoSec: 2400 } }).reason).toBe(
      '«Мониторинг» ни разу не завершил прогон за 40 мин',
    );
    expect(evaluateHealth({ status: 200, body: { ...good, monitorAgoSec: null, monitorScheduledAgoSec: 120 } }).ok).toBe(true);
    expect(monitorMaxAgeSec(15)).toBe(1800);
    expect(monitorMaxAgeSec(60)).toBe(7200);
  });

  it('tells only a change of state', () => {
    const bad = { ok: false, reason: 'billing не отвечает (TypeError)' };
    const first = transition({ ok: true, since: 1, reason: '' }, bad, 100);
    expect(first.text).toContain('🔴');
    expect(first.text).toContain(bad.reason);
    expect(first.next).toEqual({ ok: false, since: 100, reason: bad.reason });
    const still = transition(first.next, bad, 200);
    expect(still.text).toBe('');
    expect(still.next.since).toBe(100);
    const fixed = transition(still.next, { ok: true, reason: '' }, 300);
    expect(fixed.text).toContain('✅');
    expect(transition(fixed.next, { ok: true, reason: '' }, 400).text).toBe('');
    // no saved state: a failure is told, a plain ok is not
    expect(transition(null, bad, 1).text).not.toBe('');
    expect(transition(null, { ok: true, reason: '' }, 1).text).toBe('');
    expect(first.text + fixed.text).not.toMatch(/[\u2013\u2014]/);
  });

  it('the workflow only sends a message, secrets by name', () => {
    const wf = readFileSync('.github/workflows/billing-watchdog.yml', 'utf8');
    const script = readFileSync('scripts/billing-watchdog.mjs', 'utf8');
    expect(script).toContain('/sendMessage');
    // the polling and webhook calls themselves are guarded for every script and workflow in telegramPost.test.ts
    expect(wf).toContain('TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}');
    expect(wf).toContain('TELEGRAM_CHAT_ID: ${{ secrets.WATCHDOG_TELEGRAM_CHAT_ID }}');
    expect(script).not.toMatch(/console\.log\([^)]*\btoken\b/);
  });

  describe('one run', () => {
    function deps(over: { probes: unknown[]; sent?: boolean; state?: WatchdogState | null }) {
      const out = { texts: [] as string[], states: [] as WatchdogState[], sleeps: 0 };
      let i = 0;
      const d = {
        probe: async () => over.probes[Math.min(i++, over.probes.length - 1)] as { status?: number; body?: unknown; error?: string },
        send: async (t: string) => {
          out.texts.push(t);
          return over.sent !== false;
        },
        readState: () => (over.state === undefined ? null : over.state),
        writeState: (st: WatchdogState) => {
          out.states.push(st);
        },
        sleep: async () => {
          out.sleeps += 1;
        },
        log: () => {},
        now: () => 1000,
      };
      return { d, out };
    }
    const down = { error: 'TypeError' };
    const up = { status: 200, body: good };

    it('retries, then tells a new problem once and exits 0', async () => {
      const { d, out } = deps({ probes: [down, down, down], state: { ok: true, since: 1, reason: '' } });
      expect(await runWatchdog(d)).toBe(0);
      expect(out.sleeps).toBe(2);
      expect(out.texts).toHaveLength(1);
      expect(out.states[0]).toMatchObject({ ok: false, since: 1000 });
    });

    it('a blip that passes on retry tells nothing', async () => {
      const { d, out } = deps({ probes: [down, up], state: { ok: true, since: 1, reason: '' } });
      expect(await runWatchdog(d)).toBe(0);
      expect(out.texts).toHaveLength(0);
      expect(out.states[0].ok).toBe(true);
    });

    it('an unsent alert keeps the old state, so the next run retries, and the run fails', async () => {
      const prev = { ok: true, since: 1, reason: '' };
      const { d, out } = deps({ probes: [down], sent: false, state: prev });
      expect(await runWatchdog(d, 1)).toBe(1);
      expect(out.states[0]).toEqual(prev);
      const first = deps({ probes: [down], sent: false, state: null });
      expect(await runWatchdog(first.d, 1)).toBe(1);
      expect(first.out.states[0].ok).toBe(true);
    });

    it('an unsent recovery keeps the problem state and does not fail the run', async () => {
      const prev = { ok: false, since: 5, reason: 'x' };
      const { d, out } = deps({ probes: [up], sent: false, state: prev });
      expect(await runWatchdog(d)).toBe(0);
      expect(out.states[0]).toEqual(prev);
    });
  });
});

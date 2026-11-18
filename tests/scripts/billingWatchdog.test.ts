import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { readFileSync } from 'node:fs';
import {
  evaluateHealth,
  evaluateHttp,
  issueAction,
  ISSUE_LOOKUP_ATTEMPTS,
  ISSUE_LOOKUP_GAP_MS,
  monitorMaxAgeSec,
  retryCall,
  PUBLIC_ENDPOINTS,
  runWatchdog,
  shouldRetry,
  transition,
  transitionChecks,
  WATCHDOG_ATTEMPTS,
  WATCHDOG_GAP_MS,
} from '../../scripts/billing-watchdog-lib.mjs';
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

  it('treats 5xx and 530 and timeouts as down, and a billing 404 as up', () => {
    expect(evaluateHttp({ status: 200, body: null })).toEqual({ ok: true, reason: '' });
    expect(evaluateHttp({ status: 404, body: null })).toEqual({ ok: true, reason: '' });
    expect(evaluateHttp({ status: 301, body: null }).ok).toBe(true);
    expect(evaluateHttp({ status: 500, body: null })).toEqual({ ok: false, reason: 'HTTP 500' });
    expect(evaluateHttp({ status: 530, body: null })).toEqual({ ok: false, reason: 'HTTP 530' });
    expect(evaluateHttp({ error: 'TimeoutError' })).toEqual({ ok: false, reason: 'нет ответа (TimeoutError)' });
    expect(evaluateHttp(null).ok).toBe(false);
    const health = { id: 'health', url: 'https://billing.omp-player.online/health', kind: 'health', label: 'health' };
    const site = PUBLIC_ENDPOINTS.find((ep) => ep.id === 'site')!;
    expect(shouldRetry(site, { status: 530 })).toBe(true);
    expect(shouldRetry(site, { error: 'TimeoutError' })).toBe(true);
    expect(shouldRetry(site, { status: 404 })).toBe(false);
    expect(shouldRetry(health, { status: 200, body: { ok: true, botPollEnabled: true, botPollOkAgoSec: 99999 } })).toBe(false);
    expect(shouldRetry(health, { status: 200, body: null })).toBe(true);
    expect(WATCHDOG_ATTEMPTS).toBe(3);
    expect(WATCHDOG_GAP_MS).toBe(20_000);
    expect(PUBLIC_ENDPOINTS.map((ep) => ep.url)).toEqual([
      'https://billing.omp-player.online',
      'https://billing.omp-player.online/health',
      'https://omp-player.online',
    ]);
  });

  it('tells each endpoint once when it goes down or comes back', () => {
    const bad = { id: 'site', label: 'omp-player.online', ok: false, reason: 'HTTP 530' };
    const health = { id: 'health', label: 'billing.omp-player.online/health', ok: true, reason: '' };
    const billing = { id: 'billing', label: 'billing.omp-player.online', ok: true, reason: '' };
    const first = transitionChecks(null, [billing, health, bad], 100);
    expect(first.text).toContain('🔴 omp-player.online: HTTP 530');
    expect(first.text).not.toContain('billing.omp-player.online:');
    expect(first.text).not.toMatch(/[\u2013\u2014]/);
    const still = transitionChecks(first.next, [billing, health, bad], 200);
    expect(still.text).toBe('');
    expect(still.next.checks.site.since).toBe(100);
    const back = transitionChecks(still.next, [billing, health, { ...bad, ok: true, reason: '' }], 300);
    expect(back.text).toContain('✅ omp-player.online снова в порядке');
    expect(transitionChecks(back.next, [billing, health, { ...bad, ok: true, reason: '' }], 400).text).toBe('');
    // a legacy /health failure is not told again; a new site failure is, and the health check stays listed
    const healthDown = { ...health, ok: false, reason: 'бот не получал обновления 20 мин' };
    const legacy = transitionChecks({ ok: false, since: 5, reason: 'старое' }, [billing, healthDown, bad], 9);
    expect(legacy.text).toContain('🔴 omp-player.online: HTTP 530');
    expect(legacy.text).not.toContain('🔴 billing.omp-player.online/health');
    expect(legacy.text).not.toContain('старое');
    expect(legacy.text).toContain('Ещё не в порядке: billing.omp-player.online/health');
  });

  it('the workflow only sends a message, secrets by name, issue dedupe', () => {
    const wf = readFileSync('.github/workflows/billing-watchdog.yml', 'utf8');
    const script = readFileSync('scripts/billing-watchdog.mjs', 'utf8');
    const lib = readFileSync('scripts/billing-watchdog-lib.mjs', 'utf8');
    expect(script).toContain('/sendMessage');
    // the polling and webhook calls themselves are guarded for every script and workflow in telegramPost.test.ts
    expect(wf).toContain('TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}');
    expect(wf).toContain('TELEGRAM_CHAT_ID: ${{ secrets.WATCHDOG_TELEGRAM_CHAT_ID }}');
    expect(wf).toContain('workflow_dispatch');
    expect(wf).toContain("cron: '7,22,37,52 * * * *'");
    expect(wf).toContain('https://omp-player.online');
    expect(wf).toContain('https://billing.omp-player.online/health');
    expect(wf).toContain('issues: write');
    expect(wf).not.toContain('actions/cache');
    expect(wf).not.toMatch(/TELEGRAM_CHAT_ID:\s*\$\{\{\s*vars\.TELEGRAM_CHAT_ID/);
    const secretNames = [...wf.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(secretNames).toEqual(['TELEGRAM_BOT_TOKEN', 'WATCHDOG_TELEGRAM_CHAT_ID']);
    expect(script).toContain("['issue', 'create'");
    expect(script).toContain("['issue', 'close'");
    expect(script).not.toMatch(/console\.log\([^)]*\btoken\b/);
    expect(wf + script + lib).not.toMatch(/[\u2013\u2014]/);
  });

  it('opens, updates and closes one outage issue', () => {
    const down = { checks: { site: { ok: false, since: 1, reason: 'HTTP 530' }, health: { ok: true, since: 1, reason: '' } } };
    const created = issueAction(null, down);
    expect(created.action).toBe('create');
    if (created.action !== 'create') return;
    expect(created.title).toContain('простой');
    expect(created.body).toContain('omp-uptime-state');
    expect(created.body).toContain('HTTP 530');
    const open = { number: 7, body: created.body };
    expect(issueAction(open, down).action).toBe('noop');
    const changed = { checks: { ...down.checks, site: { ok: false, since: 1, reason: 'HTTP 502' } } };
    expect(issueAction(open, changed)).toMatchObject({ action: 'update', number: 7 });
    const up = { checks: { site: { ok: true, since: 2, reason: '' }, health: { ok: true, since: 1, reason: '' } } };
    expect(issueAction(open, up)).toEqual({ action: 'close', number: 7 });
    expect(issueAction(null, up).action).toBe('noop');
    // a failed lookup is not "no issue": do not open a second one, and do not close one we could not see
    expect(issueAction(null, down, { lookupFailed: true })).toEqual({ action: 'skip' });
    expect(issueAction(open, up, { lookupFailed: true })).toEqual({ action: 'skip' });
    expect(ISSUE_LOOKUP_ATTEMPTS).toBe(3);
    expect(ISSUE_LOOKUP_GAP_MS).toBe(2_000);
  });

  it('retries a failing issue lookup, and a resolved null is not a failure', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const recovered = await retryCall(
      async () => {
        n += 1;
        if (n < 3) throw new Error('gh down');
        return null;
      },
      3,
      5,
      async (ms: number) => {
        sleeps.push(ms);
      },
    );
    expect(recovered).toEqual({ ok: true, value: null });
    expect(sleeps).toEqual([5, 5]);
    const givenUp = await retryCall(
      async () => {
        throw new Error('still down');
      },
      2,
      1,
      async () => {},
    );
    expect(givenUp.ok).toBe(false);
  });

  describe('one run', () => {
    const healthEp = [{ id: 'health', url: 'https://health', kind: 'health', label: 'billing.omp-player.online/health' }];
    function deps(over: { probes: unknown[]; sent?: boolean; state?: WatchdogState | null; endpoints?: { id: string; url: string; kind: string; label: string }[] }) {
      const out = { texts: [] as string[], states: [] as WatchdogState[], sleeps: [] as number[], calls: [] as string[] };
      const endpoints = over.endpoints || healthEp;
      const n: Record<string, number> = {};
      const d = {
        endpoints,
        probe: async (url: string) => {
          out.calls.push(url);
          const i = n[url] || 0;
          n[url] = i + 1;
          const seq = over.probes;
          return seq[Math.min(i, seq.length - 1)] as { status?: number; body?: unknown; error?: string };
        },
        send: async (t: string) => {
          out.texts.push(t);
          return over.sent !== false;
        },
        readState: () => (over.state === undefined ? null : over.state),
        writeState: (st: WatchdogState) => {
          out.states.push(st);
        },
        sleep: async (ms: number) => {
          out.sleeps.push(ms);
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
      expect(out.sleeps).toEqual([20_000, 20_000]);
      expect(out.texts).toHaveLength(1);
      expect(out.states[0]?.checks?.health).toMatchObject({ ok: false, since: 1000 });
    });

    it('a blip that passes on retry tells nothing', async () => {
      const { d, out } = deps({ probes: [down, up], state: { ok: true, since: 1, reason: '' } });
      expect(await runWatchdog(d)).toBe(0);
      expect(out.texts).toHaveLength(0);
      expect(out.states[0]?.checks?.health?.ok).toBe(true);
    });

    it('an unsent alert keeps the old state, so the next run retries, and the run fails', async () => {
      const prev = { ok: true, since: 1, reason: '' };
      const { d, out } = deps({ probes: [down], sent: false, state: prev });
      expect(await runWatchdog(d, 1)).toBe(1);
      expect(out.states[0]?.checks?.health).toEqual({ ok: true, since: 1, reason: '' });
      const first = deps({ probes: [down], sent: false, state: null });
      expect(await runWatchdog(first.d, 1)).toBe(1);
      expect(first.out.states[0]?.checks?.health?.ok).toBe(true);
    });

    it('an unsent recovery keeps the problem state and does not fail the run', async () => {
      const prev = { ok: false, since: 5, reason: 'x' };
      const { d, out } = deps({ probes: [up], sent: false, state: prev });
      expect(await runWatchdog(d)).toBe(0);
      expect(out.states[0]?.checks?.health).toEqual({ ok: false, since: 5, reason: 'x' });
    });

    it('retries only the endpoint that blipped, 20s apart, and stays quiet when the retry is up', async () => {
      const endpoints = [
        { id: 'billing', url: 'https://billing', kind: 'http', label: 'billing.omp-player.online' },
        { id: 'health', url: 'https://health', kind: 'health', label: 'billing.omp-player.online/health' },
        { id: 'site', url: 'https://site', kind: 'http', label: 'omp-player.online' },
      ];
      const byUrl: Record<string, unknown[]> = {
        'https://billing': [{ status: 404 }],
        'https://health': [up],
        'https://site': [{ status: 530 }, { status: 200 }],
      };
      const out = { texts: [] as string[], sleeps: [] as number[] };
      const seen: Record<string, number> = {};
      const code = await runWatchdog({
        endpoints,
        probe: async (url: string) => {
          const i = seen[url] || 0;
          seen[url] = i + 1;
          const seq = byUrl[url];
          return seq[Math.min(i, seq.length - 1)] as { status: number; body?: unknown };
        },
        send: async (t: string) => {
          out.texts.push(t);
          return true;
        },
        readState: () => ({ ok: true, since: 1, reason: '' }),
        writeState: () => {},
        sleep: async (ms: number) => {
          out.sleeps.push(ms);
        },
        log: () => {},
        now: () => 50,
      });
      expect(code).toBe(0);
      expect(out.texts).toEqual([]);
      expect(out.sleeps).toEqual([20_000]);
      expect(seen['https://billing']).toBe(1);
      expect(seen['https://health']).toBe(1);
      expect(seen['https://site']).toBe(2);
    });
  });
});

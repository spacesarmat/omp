import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { generateKeyPairSync } from 'node:crypto';
// @ts-ignore node builtin
import { execFileSync } from 'node:child_process';
// @ts-ignore node builtin
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-ignore node builtin
import { tmpdir } from 'node:os';
// @ts-ignore node builtin
import { join } from 'node:path';
import { verifySupportCode, fromBase64Url, CODE_BAD, CODE_EXPIRED } from '../src/supportCode';
import { supportCode, publicKeyOf } from '../../scripts/donate-lib.mjs';
import { supportActive, supportUntil, SUPPORT_MAX_AHEAD_MS } from '../../src/lib/donate';

// a throwaway key pair for the tests: the owner's private key never leaves the owner's machine
const { privateKey } = generateKeyPairSync('ed25519');
const PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const PUB = publicKeyOf(PEM);
const NOW = new Date(2026, 9, 4, 12).getTime(); // 4 October 2026
declare const process: { execPath: string; env: { [k: string]: string | undefined } };
const DAY = 86400000;

describe('support code check (phone)', () => {
  it('accepts the current and the next month', async () => {
    expect(await verifySupportCode(supportCode('2026-10', PEM), NOW, PUB)).toEqual({ ok: true, month: '2026-10', until: supportUntil(2026, 10) });
    expect(await verifySupportCode(supportCode('2026-11', PEM), NOW, PUB)).toEqual({ ok: true, month: '2026-11', until: supportUntil(2026, 11) });
  });

  it('a past month has expired (except during the grace days), a later one does not fit', async () => {
    expect(await verifySupportCode(supportCode('2026-08', PEM), NOW, PUB)).toEqual({ ok: false, error: CODE_EXPIRED });
    // 2 October: the September code is still in its grace days
    expect((await verifySupportCode(supportCode('2026-09', PEM), new Date(2026, 9, 2).getTime(), PUB)).ok).toBe(true);
    expect(await verifySupportCode(supportCode('2026-09', PEM), NOW, PUB)).toEqual({ ok: false, error: CODE_EXPIRED });
    expect(await verifySupportCode(supportCode('2026-12', PEM), NOW, PUB)).toEqual({ ok: false, error: CODE_BAD });
    expect(await verifySupportCode(supportCode('2027-10', PEM), NOW, PUB)).toEqual({ ok: false, error: CODE_BAD });
    // December → January across the year
    expect((await verifySupportCode(supportCode('2027-01', PEM), new Date(2026, 11, 20).getTime(), PUB)).ok).toBe(true);
  });

  it('rejects a bad signature: another month, another key, a changed character', async () => {
    const code = supportCode('2026-10', PEM);
    const otherMonth = 'OMP-2026-11-' + code.slice('OMP-2026-10-'.length);
    expect(await verifySupportCode(otherMonth, NOW, PUB)).toEqual({ ok: false, error: CODE_BAD });
    const { privateKey: other } = generateKeyPairSync('ed25519');
    const foreign = supportCode('2026-10', other.export({ format: 'pem', type: 'pkcs8' }).toString());
    expect(await verifySupportCode(foreign, NOW, PUB)).toEqual({ ok: false, error: CODE_BAD });
    const last = code.charAt(code.length - 5);
    const flipped = code.slice(0, -5) + (last === 'A' ? 'B' : 'A') + code.slice(-4);
    expect(await verifySupportCode(flipped, NOW, PUB)).toEqual({ ok: false, error: CODE_BAD });
    // a code made with the test key does not pass the real key
    expect(await verifySupportCode(code, NOW)).toEqual({ ok: false, error: CODE_BAD });
  });

  it('rejects malformed input', async () => {
    for (const t of ['', 'привет', 'OMP-2026-10-', 'OMP-2026-10-abc', 'OMP-2026-1-' + 'A'.repeat(86)]) {
      expect(await verifySupportCode(t, NOW, PUB)).toEqual({ ok: false, error: CODE_BAD });
    }
    expect(await verifySupportCode(supportCode('2026-10', PEM), NOW, 'not-a-key')).toEqual({ ok: false, error: CODE_BAD });
  });

  it('spaces around a pasted code are fine', async () => {
    expect((await verifySupportCode('  ' + supportCode('2026-10', PEM) + '\n', NOW, PUB)).ok).toBe(true);
  });

  it('base64url decoding', () => {
    expect(Array.from(fromBase64Url('AQID_-8')!)).toEqual([1, 2, 3, 255, 239]);
    expect(fromBase64Url('a+b')).toBeNull();
    expect(fromBase64Url('A')).toBeNull();
  });
});

describe('month boundaries', () => {
  it('December → January: the January code is accepted in December, the December code until 4 January', async () => {
    const dec15 = new Date(2026, 11, 15, 12).getTime();
    expect(await verifySupportCode(supportCode('2027-01', PEM), dec15, PUB)).toEqual({ ok: true, month: '2027-01', until: supportUntil(2027, 1) });
    expect(await verifySupportCode(supportCode('2027-02', PEM), dec15, PUB)).toEqual({ ok: false, error: CODE_BAD });
    const dec = await verifySupportCode(supportCode('2026-12', PEM), dec15, PUB);
    expect(dec).toEqual({ ok: true, month: '2026-12', until: new Date(2027, 0, 4).getTime() });
    expect((await verifySupportCode(supportCode('2026-12', PEM), new Date(2027, 0, 3, 23).getTime(), PUB)).ok).toBe(true);
    expect(await verifySupportCode(supportCode('2026-12', PEM), new Date(2027, 0, 4).getTime(), PUB)).toEqual({ ok: false, error: CODE_EXPIRED });
  });

  it('grace edges: valid until the last millisecond before the end, expired at the end', async () => {
    const until = supportUntil(2026, 10);
    expect(until).toBe(new Date(2026, 10, 4).getTime());
    expect((await verifySupportCode(supportCode('2026-10', PEM), until - 1, PUB)).ok).toBe(true);
    expect(await verifySupportCode(supportCode('2026-10', PEM), until, PUB)).toEqual({ ok: false, error: CODE_EXPIRED });
    expect(supportActive(until, until - 1)).toBe(true);
    expect(supportActive(until, until)).toBe(false);
  });

  it("the longest lead (next month's code on the 1st) stays under the believable ceiling", () => {
    const jul1 = new Date(2026, 6, 1).getTime(); // July + August = 62 days, + 3 days grace
    const until = supportUntil(2026, 8);
    expect(until - jul1).toBeLessThanOrEqual(SUPPORT_MAX_AHEAD_MS);
    expect(supportActive(until, jul1)).toBe(true);
  });

  it("time zones: the code month is the phone's local month; the TVs compare only the absolute end time", async () => {
    const saved = process.env.TZ;
    try {
      for (const tz of ['Pacific/Kiritimati', 'America/Adak', 'Europe/Moscow', 'UTC']) {
        process.env.TZ = tz;
        const lastEvening = new Date(2026, 10, 30, 23, 30).getTime();
        const r = await verifySupportCode(supportCode('2026-11', PEM), lastEvening, PUB);
        expect(r).toEqual({ ok: true, month: '2026-11', until: new Date(2026, 11, 4).getTime() });
        // the 1st of December local time already counts the January code as «next month»
        expect((await verifySupportCode(supportCode('2027-01', PEM), new Date(2026, 11, 1, 0, 1).getTime(), PUB)).ok).toBe(true);
        expect((await verifySupportCode(supportCode('2027-01', PEM), new Date(2026, 10, 30, 23, 59).getTime(), PUB)).ok).toBe(false);
        // a TV elsewhere: only the ms value matters
        const until = (r as { until: number }).until;
        expect(supportActive(until, until - DAY)).toBe(true);
        expect(supportActive(until, until + 1)).toBe(false);
      }
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});

describe('scripts/donate-code.mjs', () => {
  it('signs a month with the given key; the phone accepts the printed code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-donate-'));
    try {
      const keyPath = join(dir, 'k.pem');
      writeFileSync(keyPath, PEM);
      const out = execFileSync(process.execPath, ['scripts/donate-code.mjs', '2026-11', '--key', keyPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      expect(out).toMatch(/^OMP-2026-11-[A-Za-z0-9_-]{86}$/);
      expect(await verifySupportCode(out, NOW, PUB)).toEqual({ ok: true, month: '2026-11', until: supportUntil(2026, 11) });
      // OMP_DONATE_KEY works too; a bad month is refused
      const env = { ...process.env, OMP_DONATE_KEY: keyPath };
      expect(execFileSync(process.execPath, ['scripts/donate-code.mjs', '2026-10'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim()).toMatch(/^OMP-2026-10-/);
      expect(() => execFileSync(process.execPath, ['scripts/donate-code.mjs', '2026-13'], { env, stdio: ['ignore', 'pipe', 'pipe'] })).toThrow();
      // no key given: a clear error, no default path
      const noKey = { ...process.env };
      delete noKey.OMP_DONATE_KEY;
      let err = '';
      try {
        execFileSync(process.execPath, ['scripts/donate-code.mjs', '2026-10'], { env: noKey, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        err = String((e as { stderr?: string }).stderr || '');
      }
      expect(err).toContain('OMP_DONATE_KEY');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

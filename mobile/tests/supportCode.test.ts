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
import { supportUntil } from '../../src/lib/donate';

// a throwaway key pair for the tests: the owner's private key never leaves the owner's machine
const { privateKey } = generateKeyPairSync('ed25519');
const PEM = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const PUB = publicKeyOf(PEM);
const NOW = new Date(2026, 9, 4, 12).getTime(); // 4 October 2026
declare const process: { execPath: string; env: { [k: string]: string | undefined } };

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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Support code check (phone only): «OMP-YYYY-MM-<signature>», an Ed25519 signature of «omp-support:YYYY-MM» made
// with the owner's key (scripts/donate-code.mjs). @noble/ed25519 + @noble/hashes (MIT, audited), synchronous, no
// WebCrypto at all (Chrome 90 has no Ed25519 there). The TV bundle never imports this file.
import { hashes, verify } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { parseSupportCode, supportMessage, supportUntil, SUPPORT_PUBLIC_KEY } from '../../src/lib/donate';

hashes.sha512 = sha512;

export const CODE_BAD = 'Код не подходит';
export const CODE_EXPIRED = 'Срок кода истёк';

export type CodeCheck = { ok: true; month: string; until: number } | { ok: false; error: string };

/** base64url → bytes; null when the text is not base64url. */
export function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch (e) {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ascii = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7f;
  return out;
};

/**
 * Checks a code: the signature, then the month — the current or the next one is accepted (a code of the month just
 * ended still works during the grace days); an older one has expired, a later one does not fit.
 * `publicKey`: raw 32 bytes, base64url (tests pass their own).
 */
export async function verifySupportCode(text: string, now: number = Date.now(), publicKey: string = SUPPORT_PUBLIC_KEY): Promise<CodeCheck> {
  const code = parseSupportCode(text);
  const sig = code ? fromBase64Url(code.sig) : null;
  const key = fromBase64Url(publicKey);
  if (!code || !sig || sig.length !== 64 || !key || key.length !== 32) return { ok: false, error: CODE_BAD };
  let valid = false;
  try {
    valid = verify(sig, ascii(supportMessage(code.month)), key);
  } catch (e) {
    valid = false;
  }
  if (!valid) return { ok: false, error: CODE_BAD };
  const until = supportUntil(code.year, code.mon);
  const d = new Date(now);
  const nextMonth = d.getFullYear() * 12 + d.getMonth() + 1; // months since year 0, 0-based: the next month
  if (code.year * 12 + code.mon - 1 > nextMonth) return { ok: false, error: CODE_BAD };
  if (until <= now) return { ok: false, error: CODE_EXPIRED };
  return { ok: true, month: code.month, until };
}

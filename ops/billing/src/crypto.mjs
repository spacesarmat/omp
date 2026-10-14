import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function randomId() {
  return randomBytes(8).toString('hex');
}

/** Eight characters, shown as XXXX-XXXX. No 0/O/1/I. */
export function randomCode() {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out.slice(0, 4) + '-' + out.slice(4);
}

export function normalizeCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '');
}

export function codeHash(code) {
  const n = normalizeCode(code);
  if (n.length !== 8) return '';
  return sha256(n);
}

export function deviceOk(id) {
  return typeof id === 'string' && /^[a-f0-9]{16,64}$/.test(id);
}

export function hashPassword(password, salt) {
  const s = salt || randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), s, 32).toString('hex');
  return { salt: s, hash };
}

export function passwordMatches(password, salt, hash) {
  if (!salt || !hash) return false;
  const got = scryptSync(String(password), salt, 32);
  const want = Buffer.from(hash, 'hex');
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

export function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch (e) {
    return false;
  }
}

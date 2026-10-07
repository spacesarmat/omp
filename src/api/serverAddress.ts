// Cleanup of a typed server address (TorrServer, Jackett, Prowlarr). A TV on-screen keyboard may type look-alikes:
// full-width «：１９２», a no-break or zero-width space, «,» for «.», a Cyrillic «о» for 0. The address that reaches
// the network is the cleaned one; one still not an address names its bad character instead of failing to connect.
// Chromium 53 safe: no Unicode property escapes (String.prototype.normalize is there since Chrome 34, guarded anyway).
import { t } from '../i18n';

/** Invisible characters: soft hyphen, zero-width and direction marks, word joiners, BOM. */
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;
/** Every whitespace, NBSP and the ideographic space included. */
const SPACES = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;

/** Look-alikes NFKC leaves alone. */
const EXTRA: { [c: string]: string } = {
  '\u3002': '.', // 。 ideographic full stop
  '\uFF61': '.', // ｡ half-width ideographic full stop
  '\u2024': '.', // ․ one dot leader
  '\u2236': ':', // ∶ ratio
  '\uA789': ':', // ꞉ modifier letter colon
  '\u2215': '/', // ∕ division slash
  '\u2044': '/', // ⁄ fraction slash
};

/** Cyrillic digit look-alikes, used only where the rest is digits (an IPv4 or a port). */
const CYR_DIGITS: { [c: string]: string } = { '\u043E': '0', '\u041E': '0', '\u0437': '3', '\u0417': '3' };

/** Full-width ASCII (U+FF01–U+FF5E) and the ideographic space as ASCII, for a WebView without normalize(). */
function fromFullWidth(s: string): string {
  return s.replace(/[\uFF01-\uFF5E\u3000]/g, (c) => (c === '\u3000' ? ' ' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

/**
 * The typed text without full-width forms, invisible characters and whitespace (nothing else changes). innerSpaces:
 * spaces inside are kept as plain ones and only the ends are trimmed (a stored «h h» must still be rejected).
 */
export function cleanAddressText(input: string, o: { innerSpaces?: boolean } = {}): string {
  let s = fromFullWidth(String(input || ''));
  if (typeof s.normalize === 'function') {
    try {
      s = s.normalize('NFKC');
    } catch (e) {
      /* keep the table's result */
    }
  }
  s = s.replace(INVISIBLE, '');
  s = o.innerSpaces ? s.replace(SPACES, ' ').trim() : s.replace(SPACES, '');
  return s.replace(/[\u3002\uFF61\u2024\u2236\uA789\u2215\u2044]/g, (c) => EXTRA[c]);
}

export type AddressCheck =
  | { ok: true; url: string }
  /** bad: the first character that cannot be in an address, '' when the address is malformed as a whole. */
  | { ok: false; bad: string };

/** Digits with the look-alikes made digits; null when anything else is there. */
function digitsOnly(s: string): string | null {
  if (!/^[0-9\u043E\u041E\u0437\u0417]+$/.test(s)) return null;
  return s.replace(/[\u043E\u041E\u0437\u0417]/g, (c) => CYR_DIGITS[c]);
}

function isIpv4(s: string): boolean {
  const p = s.split('.');
  return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && +x <= 255);
}

/** A dotted IPv4 written with Cyrillic look-alikes as digits, or null when it is not one. */
function ipv4LookAlike(host: string): string | null {
  const parts = host.split('.');
  // real digits must be there: «зоо.зоо.зоо.зоо» is not an IP someone meant
  if (parts.length !== 4 || !/[0-9]/.test(host)) return null;
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const d = digitsOnly(parts[i]);
    if (d === null) return null;
    out.push(d);
  }
  const ip = out.join('.');
  return isIpv4(ip) ? ip : null;
}

function firstBad(s: string, ok: RegExp): string {
  for (let i = 0; i < s.length; i++) if (!ok.test(s.charAt(i))) return s.charAt(i);
  return '';
}

/** A character as shown in the error: an invisible or control one as U+XXXX. */
export function showChar(c: string): string {
  if (!c) return c;
  const code = c.charCodeAt(0);
  if (code < 0x21 || (code >= 0x7f && code <= 0xa0)) return 'U+' + ('000' + code.toString(16).toUpperCase()).slice(-4);
  return c;
}

/**
 * The cleaned TorrServer address: http:// and the port 8090 are added when neither the scheme nor the port is typed,
 * the scheme is lowercased, trailing slashes go. { ok: false, bad } when the host:port is still not a hostname/IP
 * with a numeric port.
 */
export function checkServerAddress(input: string): AddressCheck {
  let s = cleanAddressText(input);
  let scheme = '';
  const sm = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (sm) {
    scheme = sm[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return { ok: false, bad: '' };
    s = s.slice(sm[0].length);
  }
  const cut = s.search(/[/?#]/);
  let authority = cut < 0 ? s : s.slice(0, cut);
  const path = (cut < 0 ? '' : s.slice(cut)).replace(/\/+$/, '');
  if (path && /[\s\\]/.test(path)) return { ok: false, bad: firstBad(path, /[^\s\\]/) };
  let userinfo = '';
  const at = authority.lastIndexOf('@');
  if (at >= 0) {
    userinfo = authority.slice(0, at + 1);
    authority = authority.slice(at + 1);
  }
  let host = authority;
  let port = '';
  if (/^\[/.test(authority)) {
    // [IPv6]:port
    const m = /^(\[[0-9a-f:.]+\])(?::(.*))?$/i.exec(authority);
    if (!m) return { ok: false, bad: firstBad(authority, /[0-9a-f:.[\]]/i) };
    host = m[1];
    port = m[2] !== undefined ? m[2] : '';
    if (m[2] !== undefined && !port) return { ok: false, bad: '' };
  } else {
    const colon = authority.lastIndexOf(':');
    if (colon >= 0) {
      host = authority.slice(0, colon);
      port = authority.slice(colon + 1);
      if (!port) return { ok: false, bad: '' };
    }
    // a stray dot or comma at the end (the keyboard's «.» next to OK) is dropped
    host = host.replace(/,/g, '.').replace(/\.+$/, '');
    if (!host) return { ok: false, bad: '' };
    const ip = ipv4LookAlike(host);
    if (ip) host = ip;
    else {
      const bad = firstBad(host, /[a-z0-9.\-_]/i);
      if (bad) return { ok: false, bad };
      if (/^[\d.]+$/.test(host) && !isIpv4(host)) return { ok: false, bad: '' };
      if (/^\.|\.\.|^-/.test(host)) return { ok: false, bad: '' };
    }
  }
  if (port) {
    const p = /[0-9]/.test(port) ? digitsOnly(port) : null;
    if (p === null) return { ok: false, bad: firstBad(port, /[0-9]/) };
    if (+p < 1 || +p > 65535) return { ok: false, bad: '' };
    port = String(+p);
  }
  if (!scheme && !port) port = '8090';
  return { ok: true, url: (scheme || 'http') + '://' + userinfo + host + (port ? ':' + port : '') + path };
}

/** The address as the TV and phone fields show it: without http://. */
export function addressForField(url: string): string {
  return url.replace(/^http:\/\//i, '');
}

/** «В адресе есть недопустимый символ: «，»», or the generic «Неверный адрес» when no single character is to blame. */
export function addressErrorText(bad: string): string {
  return bad ? t('connect.badChar', { char: showChar(bad) }) : t('connect.badAddress');
}
